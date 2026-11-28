/**
 * AutoSchedulerController — Two-Layer Pipeline Orchestration (v2)
 *
 * Layer 1 — Optimization (OR-Tools CP-SAT):
 *   Sends unassigned shifts + employees to the Python service.
 *   Receives proposed assignment map (proposals only, never writes DB).
 *
 * Layer 2 — Compliance Validation:
 *   AssignmentValidator.simulate() validates each proposal against the
 *   employee's real schedule (incremental feasibility check).
 *
 * Concurrency Recheck (Critical):
 *   Before final DB commit, simulate() is re-run with fresh DB state to
 *   catch any assignments made by other users since the preview was shown.
 *
 * Fallback Strategy:
 *   INFEASIBLE / UNKNOWN / CONNECTION_REFUSED → falls back to the incremental
 *   greedy assignment engine (first-fit over unfilled shifts).
 *
 * Usage:
 *   const preview = await autoSchedulerController.run(shifts, employees);
 *   // Manager reviews preview in AutoSchedulerPanel
 *   const result  = await autoSchedulerController.commit(preview);
 */

import { parseISO, startOfISOWeek } from 'date-fns';
import { optimizerClient, OptimizerError } from './optimizer/optimizer.client';
import { solutionParser } from './optimizer/solution-parser';
import { assignmentValidator, type ValidationRunResult } from '@/modules/scheduling/validation';
import { assignmentCommitter } from '@/modules/scheduling/validation/engine/assignment-committer';
import { parseZonedDateTime, formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { extractLevel } from '../rosters/domain/projections/utils/cost';
import { estimateDetailedShiftCost as estimateDetailedShiftCostObj } from '../rosters/domain/projections/utils/cost/index';
import { resolveRateSet, type RateSet } from '../rosters/domain/projections/utils/cost/rate-schedule';
import { resolveCardOn, type PricedCard, type RateCardSchedule } from '../rosters/domain/projections/utils/cost/rate-card-resolver';
import type { RateCardLoadings } from '../rosters/domain/projections/utils/cost/loadings';
import { fetchPublishedRateCardSchedules } from '../payroll/data/ebaRates.read.api';
import { calculateFatigueWithRecovery, effectiveMinutes, FATIGUE_BANDS } from '../rosters/domain/projections/utils/fatigue';
import { calculateUtilization } from '../rosters/domain/projections/utils/fairness';
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import {
    isFlexibleEmploymentStatus,
    isFullTimeEmployee,
    resolveEmploymentType,
    toTargetEmploymentType,
} from '@/modules/core/model/employment.types';
import type { EmployeeInfo } from '@/modules/scheduling/validation/types';
import type { AvailabilityOverrideRef, ExistingShiftRef, SchedulerMode, SolverPricingPolicy, SolverSchedulerMode } from './types';
import { auditor } from './audit/auditor';
import { rosterFetcher, durationMinutes, shiftDate } from './data/roster-fetcher';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import {
    categoryMinutes,
    effectiveDebtsByEmployee,
    strategyMult,
    shiftFairnessPenaltyCents,
    type FairnessMetric,
} from '@/modules/rosters/domain/fairness-ledger';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { v8ConfigFromLoadings } from '@/modules/compliance/v8/swap-engine/constraint-engine';
import type { SolverConfig } from '@/modules/compliance/v8/swap-engine/types';
import type {
    OptimizeRequest,
    OptimizeResponse,
    OptimizerEmployee,
    OptimizerShift,
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerConstraints,
    OptimizerStrategy,
    OptimizerHealth,
    OptimizerStatus,
    CapacityCheck,
    CapacityDayBreakdown,
    PillarScores,
    BindingConstraint,
    ParetoAlternative,
    AssignmentRationale,
    FairnessLedgerRunStatus,
} from './types';

// B1 — Single-mode policy. The autoscheduler no longer exposes cost/fatigue/
// fairness sliders: the solver optimises a fixed lexicographic priority
// (coverage » guardrails » cost, see model_builder.py). Weights are sent only
// because the wire schema requires them; under lexicographic tiers they are
// cross-tier-irrelevant and pinned to the calibrated 1.0× defaults.
/**
 * The constraint block every solve sends.
 *
 * Availability is a HARD constraint for the auto-scheduler — unset means
 * unavailable and the solver may never place a shift outside a declared block —
 * so it is forced on regardless of what the caller supplied.
 *
 * The cl 28.4 split-shift allowance is resolved HERE rather than defined in the
 * solver, because the amount is effective-dated ($11.13 under EA 2025, $11.70
 * from 6 Jul 2026, CPI-indexed after) and a Python constant would be the stale
 * copy that disagrees with the roster grid and payroll. Without it the solver
 * priced a part-timer's second same-day engagement as if it were free, and its
 * cost is the number the AutoScheduler shows.
 *
 * Keyed on the EARLIEST shift date in the batch. A roster spanning a 1 July
 * increase would price the whole batch at the old rate; that is one day a year,
 * the error is bounded by a single allowance, and the alternative — a per-shift
 * rate on a per-day allowance — has no well-defined answer for a pair that
 * straddles the boundary.
 */
function buildSolverConstraints(
    supplied: OptimizeRequest['constraints'] | undefined,
    shifts: OptimizerShift[],
    schedulerMode?: SolverSchedulerMode,
    card?: PricedCard | null,
): OptimizeRequest['constraints'] {
    const earliest = shifts.reduce<string | undefined>(
        (min, s) => (!min || (s.shift_date && s.shift_date < min) ? s.shift_date : min),
        undefined,
    );
    // The organization's card when there is one (run() refuses an organization
    // without a card covering the window); the embedded schedule otherwise.
    const rateSet = card?.rateSet ?? resolveRateSet(earliest);
    return {
        min_rest_minutes: 600,
        relax_constraints: false,
        ...supplied,
        enforce_availability: true,
        // Cents: the CP-SAT objective is integral, and 1113 is exact where
        // 11.13 is not.
        split_shift_allowance_cents: Math.round(rateSet.allowances.splitShift * 100),
        ...(schedulerMode ? { scheduler_mode: schedulerMode } : {}),
        ...(card ? { pricing_policy: solverPricingPolicy(card.loadings) } : {}),
    };
}

/** The card's loadings and operational thresholds as the solver reads them (PricingPolicyReq). */
export function solverPricingPolicy(l: RateCardLoadings): SolverPricingPolicy {
    return {
        casual_loading: l.casualLoading,
        saturday_loading: l.saturdayLoading,
        sunday_loading: l.sundayLoading,
        public_holiday_loading: l.publicHolidayLoading,
        night_loading_mon_thu: l.nightLoadingMonThu,
        night_loading_fri: l.nightLoadingFri,
        night_loading_sat_sun: l.nightLoadingSatSun,
        overtime_first_hours: l.overtimeFirstHours,
        overtime_first_multiplier: l.overtimeFirstMultiplier,
        overtime_after_multiplier: l.overtimeAfterMultiplier,
        ordinary_daily_cap_hours: l.ordinaryDailyCapHours,
        security_ordinary_cap_hours: l.securityOrdinaryCapHours,
        min_engagement_minutes: l.minEngagementMinutes,
        min_engagement_sunday_minutes: l.minEngagementSundayMinutes,
        min_engagement_public_holiday_minutes: l.minEngagementPublicHolidayMinutes,
        min_engagement_training_minutes: l.minEngagementTrainingMinutes,
    };
}

const SINGLE_MODE_STRATEGY: OptimizerStrategy = {
    fatigue_weight: 50, fairness_weight: 50, cost_weight: 50, coverage_weight: 100,
};

// Default per-employee daily working-minute cap used by the capacity pre-check
// when employee.max_daily_minutes is not supplied. 10h = 600m.
const DEFAULT_MAX_DAILY_MINUTES = 600;

// ── Security Schedule 3 rate resolution (compliance audit finding — 2026-08-02) ──
// Full-time Security Level 3-6 is paid the Schedule 2 §2 ANNUALISED rate, not
// the generic Schedule 2 §1 wage table — materially higher (~15-20%) because it
// already absorbs penalties/night/leave loading (Sch.3 §4.1(b)). Extracted as
// small pure functions (rather than inlined in the employee-mapping closure) so
// the derivation is independently unit-testable without standing up the whole
// `.run()` pipeline.
const SECURITY_ANNUALISED_LEVELS = new Set([3, 4, 5, 6]);

/**
 * Role IDs that appear on at least one Security-named shift in the current
 * optimization batch. Used as a best-effort "is this employee Security"
 * signal when the caller doesn't supply `employeeDetails.is_security_role`
 * explicitly — there is no per-employee classification field on the wire
 * today (see the audit's P2 remediation item for the structural fix).
 */
export function deriveSecurityRoleIds(shifts: { role_id?: string | null; roleName?: string }[]): Set<string> {
    return new Set(
        shifts
            .filter(s => isSecurityRoleName(s.roleName))
            .map(s => s.role_id)
            .filter((id): id is string => !!id),
    );
}

/**
 * Resolve the Schedule 2 §2 Security annualised hourly rate for a full-time
 * Security Level 3-6 employee, or `null` when it doesn't apply (the caller
 * should fall back to the generic Schedule 2 §1 wage table in that case).
 */
export function resolveSecurityAnnualisedRate(
    rateSet: RateSet,
    opts: { isFullTime: boolean; isSecurityEmployee: boolean; level?: number },
): number | null {
    if (!opts.isFullTime || !opts.isSecurityEmployee) return null;
    if (!opts.level || !SECURITY_ANNUALISED_LEVELS.has(opts.level)) return null;
    const key = `level${opts.level}` as keyof RateSet['security']['annualisedHourly'];
    return rateSet.security.annualisedHourly[key] ?? null;
}

// ── Employee contract details from hr.user_contracts (compliance audit
// finding — 2026-08-02) ─────────────────────────────────────────────────────
// `RosterFetcher.fetchEmployeeContractDetails()` resolves each employee's
// real Schedule 1/2 classification level, Schedule 3 Security status, and
// Schedule 4/5/6 (apprentice/trainee/SWS) category from their Active
// `user_contracts` row — see the docblock on that method for the full
// rationale. This merges that contract-derived baseline with whatever the
// caller explicitly supplied via `employeeDetails`: the caller's fields
// always win per-employee, per-field, since a caller-supplied value is a
// deliberate override (e.g. a UI screen letting a manager correct a
// classification for one run) rather than a stale/absent one.
export function mergeEmployeeDetails(
    contractDetails: Map<string, Partial<OptimizerEmployee>>,
    callerSupplied: Map<string, Partial<OptimizerEmployee>> | undefined,
): Map<string, Partial<OptimizerEmployee>> {
    if (!callerSupplied || callerSupplied.size === 0) return contractDetails;
    const merged = new Map<string, Partial<OptimizerEmployee>>();
    const ids = new Set([...contractDetails.keys(), ...callerSupplied.keys()]);
    for (const id of ids) {
        merged.set(id, { ...contractDetails.get(id), ...callerSupplied.get(id) });
    }
    return merged;
}

// ── HC-7 contract obligation: leave-aware, contract-weighted ─────────────────
//
// WHY THIS EXISTS. `_add_min_contract_hours()` in the optimizer charges a
// Tier-1 penalty of 100,000 PER MINUTE for every contracted minute an FT/PT
// employee is not given. The two numbers feeding that penalty were both wrong
// in the same direction — they over-stated the obligation — and the solver has
// no way to report an obligation it cannot satisfy: it just absorbs the slack,
// which silently flattens every real trade-off ranked beneath Tier 1.
//
//   1. LEAVE WAS NOT DEDUCTED. The window obligation was
//      `weeklyMinutes * weekScale` with no credit for approved leave, even
//      though the very same approved-leave dates are handed to the solver as
//      `unavailable_dates` (a HARD per-day exclusion). So an FT on two weeks'
//      annual leave inside a four-week window was simultaneously told "you may
//      not work these 14 days" and "you still owe 152 hours". The solver's only
//      moves are to eat an unavoidable ~1e9 penalty or to cram the full
//      obligation into the remaining fortnight.
//
//   2. THE FAIR-SHARE CAP WAS UNWEIGHTED. `totalDemand / headcount * 1.2`
//      divides demand by RAW headcount, so contract obligation is diluted by
//      the casual bench. Production carries 83 active casuals against 17 FT and
//      4 PT, which shrinks an FT's cap to ~1/104 of window demand — well under
//      their real 38h, so the cap (added to stop HC-7 dominating coverage) was
//      instead erasing the obligation it was meant to bound. Weighting each
//      employee's slice by their own contracted minutes restores the intent:
//      the cap still bounds HC-7 on a demand-poor window, but a full-timer's
//      share no longer depends on how many casuals are on the books.
//
// Both are pure arithmetic over data the controller already has in hand, so
// neither needs a schema change or an optimizer-service redeploy.

/** Head-room over an employee's weighted slice of demand before HC-7 is capped. */
export const FAIR_SHARE_BUFFER = 1.2;

/**
 * Turn pending-leave dates into SOFT whole-day availability overrides.
 *
 * WHOLE DAY, because `leave_requests` records a date range and not times — the
 * window is the full calendar day, and the solver's overlap test then catches
 * any shift touching it. `00:00`–`23:59` rather than `24:00` so the window
 * cannot be read as crossing midnight into the following day, which would
 * penalise a shift the leave does not cover.
 *
 * SOFT, because a request is not a decision. Hard-excluding pending leave
 * would let anyone remove themselves from the roster simply by asking for it.
 * At 5000c the solver prefers almost any other candidate but will still cover
 * the shift if nobody else can — coverage outranks this by design.
 *
 * Existing overrides from `employeeDetails` are preserved: the caller may be
 * supplying real exceptions, and this must add to them rather than replace.
 */
export function buildPendingLeaveOverrides(
    pendingLeaveDates: readonly string[],
    existing?: readonly AvailabilityOverrideRef[],
): AvailabilityOverrideRef[] {
    const overrides: AvailabilityOverrideRef[] = [...(existing ?? [])];
    // Dedupe against anything the caller already sent for the same date, so a
    // detail map that has been through this once does not double-penalise.
    const alreadyCovered = new Set(
        overrides.filter(o => o.severity === 'SOFT' && o.date).map(o => o.date),
    );
    for (const date of new Set(pendingLeaveDates)) {
        if (alreadyCovered.has(date)) continue;
        overrides.push({ start_time: '00:00', end_time: '23:59', severity: 'SOFT', date });
    }
    return overrides;
}

/**
 * Default weekly contracted minimum, in minutes, when no `employeeDetails`
 * override supplies one.
 *
 * Nothing in `fetchEmployeeContractDetails` populates `min_contract_minutes`,
 * so in practice this IS the obligation for every run that does not pass a
 * caller-supplied override — which makes it the single place the FT/PT/casual
 * baseline may be written. Casuals return 0 and are thereby exempt from HC-7,
 * matching `_add_min_contract_hours`'s `<= 0` skip.
 */
/** ICC EBA Schedule 3 §3.1(d) — Full-Time Security weekly contract (38h ord + 4h add'l = 42h). */
export const FT_SECURITY_WEEKLY_CONTRACT_MINUTES = 2520;
/** ICC EBA cl 12.4(a), cl 35.3(a) — Flexible Part-Time statutory minimum baseline (624h/52w = 12h/wk = 720m). */
export const FPT_WEEKLY_CONTRACT_MINUTES = 720;

export function baselineWeeklyContractMinutes(
    contractType: string | null | undefined,
    opts?: { isSecurityRole?: boolean; isFlexible?: boolean },
): number {
    const raw = contractType || '';
    if (raw === 'FT' || /full/i.test(raw)) {
        return opts?.isSecurityRole ? FT_SECURITY_WEEKLY_CONTRACT_MINUTES : 2280; // 42h vs 38h
    }
    if (raw === 'FLEXI_PART_TIME' || opts?.isFlexible) {
        return FPT_WEEKLY_CONTRACT_MINUTES; // 720m (12h/wk)
    }
    if (raw === 'PT' || /part/i.test(raw)) return 1200;  // 20h
    return 0;                                            // casual — HC-7 exempt
}

/**
 * Resolve a Regular Part-Time employee's weekly contracted minutes (ICC EBA
 * cl 12.3(b): predetermined hours strictly `< 38` per week).
 *
 * `EligibilityService` defaults unset `contracted_weekly_hours` to `38`, so
 * guarding `> 0 && < 38` honours real predetermined PT contracts (e.g. 15h,
 * 20h, 24h, 30h, 35h) while falling back to `baselineWeeklyContractMinutes('PT')`
 * (`1200m` = `20h`) when unset.
 */
export function resolvePtWeeklyContractMinutes(
    e: Pick<EmployeeMeta, 'contracted_weekly_hours'>,
    overrideMinContractMinutes?: number,
): number {
    if (overrideMinContractMinutes != null) return overrideMinContractMinutes;
    if (
        typeof e.contracted_weekly_hours === 'number' &&
        Number.isFinite(e.contracted_weekly_hours) &&
        e.contracted_weekly_hours > 0 &&
        e.contracted_weekly_hours < 38
    ) {
        return Math.round(e.contracted_weekly_hours * 60);
    }
    return baselineWeeklyContractMinutes('PT');
}

/**
 * Resolve a Flexible Part-Time employee's weekly contracted minutes (ICC EBA
 * cl 12.4(a) & cl 35.3(a): minimum 624h per annum = 12h/week = 720m baseline,
 * up to 38h/week cycle average).
 */
export function resolveFptWeeklyContractMinutes(
    e: Pick<EmployeeMeta, 'contracted_weekly_hours'>,
    overrideMinContractMinutes?: number,
): number {
    if (overrideMinContractMinutes != null) return overrideMinContractMinutes;
    if (
        typeof e.contracted_weekly_hours === 'number' &&
        Number.isFinite(e.contracted_weekly_hours) &&
        e.contracted_weekly_hours > 0 &&
        e.contracted_weekly_hours <= 38
    ) {
        return Math.round(e.contracted_weekly_hours * 60);
    }
    return FPT_WEEKLY_CONTRACT_MINUTES;
}

/**
 * Each employee's contract-weighted slice of the window's assignable demand.
 *
 * `weeklyContractMinutes` is the WEEKLY basis (0 for casuals, who are exempt
 * from HC-7 entirely — `_add_min_contract_hours` skips `<= 0`). A zero-weight
 * employee therefore gets a zero cap, which changes nothing for them because
 * their obligation is already zero.
 *
 * Falls back to the old uniform `demand / headcount` split when the pool
 * carries no contracted obligation at all (an all-casual scope), so the
 * division can never be by zero.
 */
export function buildFairShareCaps(
    totalDemandMinutes: number,
    weeklyContractMinutes: ReadonlyMap<string, number>,
): Map<string, number> {
    const caps = new Map<string, number>();
    let totalWeight = 0;
    for (const minutes of weeklyContractMinutes.values()) {
        if (minutes > 0) totalWeight += minutes;
    }

    if (totalWeight <= 0) {
        const uniform = (totalDemandMinutes / Math.max(1, weeklyContractMinutes.size))
            * FAIR_SHARE_BUFFER;
        for (const id of weeklyContractMinutes.keys()) caps.set(id, uniform);
        return caps;
    }

    for (const [id, minutes] of weeklyContractMinutes) {
        const weight = minutes > 0 ? minutes / totalWeight : 0;
        caps.set(id, totalDemandMinutes * weight * FAIR_SHARE_BUFFER);
    }
    return caps;
}

interface ContractObligationInput {
    /** Weekly contracted minimum, in minutes. 0 for casuals. */
    weeklyContractMinutes: number;
    /** Window length in weeks — `diffDays / 7`, the same scale the caps use. */
    weekScale: number;
    /**
     * Count of approved-leave CALENDAR dates inside the window, as produced by
     * `RosterFetcher.fetchApprovedLeave` (which expands every date between
     * start and end, weekends included).
     */
    leaveDays: number;
    /** This employee's entry from {@link buildFairShareCaps}. */
    fairShareCapMinutes: number;
}

/**
 * The window obligation HC-7 should hold this employee to.
 *
 * LEAVE IS CREDITED PRO-RATA ON CALENDAR DAYS (`weekly / 7` per leave date),
 * deliberately matching the basis the obligation itself is built on: `weekScale`
 * is `diffDays / 7`, so the gross obligation is already a per-calendar-day rate.
 * Crediting leave the same way makes a full week of leave cancel exactly one
 * week of obligation, which is the case that matters.
 *
 * The known imprecision is short spells that straddle non-working days — a
 * Fri–Mon leave spans 4 calendar dates but costs the roster 2 working days, so
 * it over-credits by roughly half a day. That errs toward UNDER-obligating,
 * which is the safe direction: an over-stated obligation is what makes the
 * solver eat unavoidable slack or cram hours into the days around the leave,
 * whereas an under-stated one merely leaves a little contract pressure on the
 * table. Costing leave in working days instead would need the employee's
 * roster pattern, which is exactly the ordinary-hours envelope this codebase
 * does not model yet.
 */
export function resolveContractObligationMinutes(
    input: ContractObligationInput,
): number {
    const { weeklyContractMinutes, weekScale, leaveDays, fairShareCapMinutes } = input;
    const afterLeave = windowContractObligationMinutes(
        weeklyContractMinutes, weekScale, leaveDays,
    );
    if (afterLeave <= 0) return 0;

    return Math.min(afterLeave, Math.max(0, fairShareCapMinutes));
}

/**
 * The same obligation BEFORE the fair-share cap is applied — i.e. what this
 * employee's contract actually entitles them to across the window, net of
 * leave.
 *
 * This, not the capped figure, is the denominator a utilization ratio wants.
 * The cap is a safety valve on the solver's OBJECTIVE (it stops Tier-1 HC-7
 * outbidding coverage on a demand-poor window); it is not a statement about
 * what the employee is owed, so letting it redefine "100% utilized" would make
 * a starved full-timer read as fully loaded precisely when the window is too
 * thin to load them.
 */
export function windowContractObligationMinutes(
    weeklyContractMinutes: number,
    weekScale: number,
    leaveDays: number,
): number {
    if (weeklyContractMinutes <= 0) return 0;
    const gross = weeklyContractMinutes * weekScale;
    const leaveCredit = (weeklyContractMinutes / 7) * Math.max(0, leaveDays);
    return Math.max(0, gross - leaveCredit);
}

/**
 * Minutes an employee is scheduled for INSIDE the optimization window — the
 * numerator of the greedy fallback's utilization ratio.
 *
 * Two things this has to get right, both of which the inline reduce it
 * replaces got wrong:
 *
 *   • `fetchExistingRoster` deliberately reaches 28 days behind the window to
 *     give the rest-gap and rolling-average checks their context. Those days
 *     are not part of this window's obligation, so they must not be counted
 *     against a window-sized denominator.
 *   • `acc + s.duration_minutes || 0` parses as `(acc + duration) || 0`. A
 *     shift with no `duration_minutes` therefore produced `NaN || 0` and reset
 *     the accumulator to zero instead of contributing nothing.
 *
 * A null `windowStartDate` (no shifts) disables the date filter rather than
 * dropping everything.
 */
export function inWindowScheduledMinutes(
    shifts: readonly { shift_date?: string; duration_minutes?: number }[],
    windowStartDate: string | null,
): number {
    let total = 0;
    for (const shift of shifts) {
        if (windowStartDate !== null && (shift.shift_date ?? '') < windowStartDate) continue;
        const minutes = shift.duration_minutes;
        if (typeof minutes === 'number' && Number.isFinite(minutes)) total += minutes;
    }
    return total;
}

/** The greedy scorer's utilization term. Neutral when there is no contract. */
interface GreedyUtilizationTerms {
    /** Percent of the window obligation already scheduled. 0 when undefined. */
    utilization: number;
    /** Subtracted from the candidate score. Over-cap only. */
    penalty: number;
    /** Added to the candidate score. Under-loaded only. */
    bonus: number;
}

/** Under this percentage a candidate is "under-loaded" and gains the bonus. */
const GREEDY_UNDER_UTILIZED_PCT = 80;
/** Over this percentage a candidate is over-cap and takes the penalty. */
const GREEDY_OVER_UTILIZED_PCT = 100;

/**
 * Score the utilization of one candidate.
 *
 * ZERO OBLIGATION IS NEUTRAL, NOT ZERO PERCENT. Casuals (and anyone whose
 * leave spans the whole window) carry no contract floor, and
 * `calculateUtilization` returns 0 for a zero denominator — but 0% is the
 * deepest point of the under-utilization bonus, so reading it literally hands
 * every casual the maximum boost and ranks them above a half-loaded
 * full-timer. That inverts the preference this term exists to express, and it
 * is the same starvation the solver's HC-7 floor is there to prevent. Both
 * sides return 0 instead: utilization against a contract is undefined without
 * a contract.
 */
export function greedyUtilizationTerms(
    scheduledMinutes: number,
    obligationMinutes: number,
    fairnessMult: number,
): GreedyUtilizationTerms {
    if (!(obligationMinutes > 0)) return { utilization: 0, penalty: 0, bonus: 0 };

    const utilization = calculateUtilization(scheduledMinutes / 60, obligationMinutes / 60);
    return {
        utilization,
        penalty: utilization > GREEDY_OVER_UTILIZED_PCT
            ? (utilization - GREEDY_OVER_UTILIZED_PCT) * 10
            : 0,
        bonus: utilization < GREEDY_UNDER_UTILIZED_PCT
            ? (GREEDY_UNDER_UTILIZED_PCT - utilization) * 5 * fairnessMult
            : 0,
    };
}

// ── cl 42 weekly overtime for the greedy-fallback cost estimate (compliance
// audit finding — 2026-08-02) ────────────────────────────────────────────────
// The roster-grid projection pipeline already threads `priorOrdinaryHoursThis
// Week` into the cost engine (post-commit); the AutoScheduler's OWN pre-commit
// preview never did, so a manager reviewing the fallback path's "Total Cost"
// could see a figure understating true weekly overtime. Mirrors the same
// isoWeekKey/group/sort/accumulate pattern as
// `projections/projectors/shared.ts`'s `buildPriorOrdinaryMap`, but combines
// each employee's EXISTING committed roster (already fetched for the rest-gap/
// fatigue checks) with the newly proposed shifts from this run.

/** ISO-8601 week key `YYYY-Www` (Monday-anchored). Mirrors the roster pipeline's helper. */
function isoWeekKey(dateStr: string): string {
    const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

interface WeeklyOrdinaryEntry {
    key: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    unpaidBreakMinutes: number;
    isExisting: boolean;
}

/**
 * Builds `proposalShiftId -> priorOrdinaryHoursThisWeek` for the greedy
 * fallback's re-estimate, from the union of each employee's existing
 * committed roster and this run's newly PASSING, non-casual proposals
 * (casual weekly OT is ambiguous under the EA — see cost/standard.ts).
 * Existing shifts seed the running total; only proposal shift IDs are
 * ever present in the returned map.
 *
 * Hours accrue NET of the unpaid break, as `netMinutesFromDTO` does in the
 * roster pipeline: a meal break is not worked, and counting it pushed staff
 * into weekly overtime early. `shifts` supplies proposals' breaks, which
 * `ValidatedProposal` does not carry.
 */
export function buildGreedyFallbackPriorOrdinaryMap(
    proposals: ValidatedProposal[],
    existingRoster: Map<string, ExistingShiftRef[]>,
    shifts: ShiftMeta[] = [],
): Map<string, number> {
    const prior = new Map<string, number>();
    const unpaidByShift = new Map(shifts.map(s => [s.id, s.unpaid_break_minutes ?? 0]));
    const byEmpWeek = new Map<string, Map<string, WeeklyOrdinaryEntry[]>>();

    const pushEntry = (employeeId: string, entry: WeeklyOrdinaryEntry) => {
        const wk = isoWeekKey(entry.shiftDate);
        let weeks = byEmpWeek.get(employeeId);
        if (!weeks) { weeks = new Map(); byEmpWeek.set(employeeId, weeks); }
        let list = weeks.get(wk);
        if (!list) { list = []; weeks.set(wk, list); }
        list.push(entry);
    };

    for (const [employeeId, shifts] of existingRoster.entries()) {
        for (const s of shifts) {
            pushEntry(employeeId, {
                key: s.id, shiftDate: s.shift_date, startTime: s.start_time, endTime: s.end_time,
                unpaidBreakMinutes: s.unpaid_break_minutes ?? 0, isExisting: true,
            });
        }
    }
    for (const p of proposals) {
        if (!p.passing || !p.employeeId) continue;
        if (/casual/i.test(p.employmentType || '')) continue;
        pushEntry(p.employeeId, {
            key: p.shiftId, shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
            unpaidBreakMinutes: unpaidByShift.get(p.shiftId) ?? 0, isExisting: false,
        });
    }

    for (const weeks of byEmpWeek.values()) {
        for (const list of weeks.values()) {
            list.sort((a, b) =>
                a.shiftDate === b.shiftDate ? a.startTime.localeCompare(b.startTime) : a.shiftDate.localeCompare(b.shiftDate),
            );
            let running = 0;
            for (const entry of list) {
                if (!entry.isExisting) prior.set(entry.key, running);
                const net = Math.max(0, durationMinutes(entry.startTime, entry.endTime) - entry.unpaidBreakMinutes) / 60;
                const dailyOt = Math.max(0, net - 12);
                running += Math.max(0, net - dailyOt);
            }
        }
    }

    return prior;
}

// The greedy fallback never calls the optimizer, so it has no solver cost and
// re-estimates each proposal with the roster cost engine.
export function estimateGreedyFallbackCost(
    shift: ShiftMeta,
    emp: EmployeeMeta,
    empDet: Partial<OptimizerEmployee> | undefined,
    priorOrdinaryHoursThisWeek: number | undefined,
    rateCards?: RateCardSchedule,
): number {
    // cl 36.1 vs Sch.3 §3.2/§5.3: the unpaid meal break is
    // deducted for general staff, but Security meal breaks are
    // PAID — the full clock span is priced. `durationMinutes()`
    // alone is the GROSS span with no break subtraction at all;
    // compliance audit finding (2026-08-02): this previously
    // priced every fallback shift's unpaid break as paid time.
    const isSecurityShift = empDet?.is_security_role
        ?? isSecurityRoleName(shift.roleName);
    const grossMins = durationMinutes(shift.start_time, shift.end_time);
    const mins = isSecurityShift
        ? grossMins
        : Math.max(0, grossMins - (shift.unpaid_break_minutes ?? 0));
    const resolvedEmpType = resolveEmploymentType(emp.employment_status, emp.contract_type);
    const employmentType = resolvedEmpType === 'Casual'
        ? 'Casual'
        : resolvedEmpType === 'PT' ? 'Part-Time' : 'Full-Time';
    // Object-based call (replaces the former 32-positional-argument
    // legacy wrapper — an auditability risk the compliance audit
    // flagged: a silent argument-order mistake would compile
    // without error). Also wires cl 42 weekly OT — previously
    // absent from the AutoScheduler's own pre-commit estimate even
    // though the roster-grid projection pipeline already had it.
    return estimateDetailedShiftCostObj({
        netMinutes: mins,
        start_time: shift.start_time,
        end_time: shift.end_time,
        // No rate: the engine resolves it from classificationLevel. A supplied
        // rate would win over the level.
        rate: null,
        scheduled_length_minutes: mins,
        is_overnight: (shift as any).is_overnight ?? false,
        is_cancelled: false,
        shift_date: shift.shift_date,
        // cl 41 / 43 attach to hours WORKED — the break's position moves them.
        unpaid_break_minutes: isSecurityShift ? 0 : (shift.unpaid_break_minutes ?? 0),
        break_start: (shift as { break_start?: string | null }).break_start ?? null,
        employmentType: employmentType as any,
        isSecurityRole: isSecurityShift,
        // Prefer the employee's REAL Schedule 1/2 classification
        // level from their Active user_contracts row (compliance
        // audit finding — 2026-08-02) over extractLevel()'s
        // role-name guess, which is now only a fallback for
        // employees with no resolvable contract level.
        classificationLevel: (empDet?.level && empDet.level >= 1 && empDet.level <= 7)
            ? `LEVEL_${empDet.level}`
            : extractLevel(shift.roleName),
        priorOrdinaryHoursThisWeek,
        rateCards,
    }).totalCost;
}

// Upper bound on the initial fatigue score handed to the optimizer. The raw
// score is unbounded — a single near-38h shift yields ~450 from the
// -76·ln(1-h/38) curve near its asymptote — and a huge value distorts the
// solver's fatigue objective (and previously, with the solver's old fixed
// 5000-minute var domains, could force the whole model INFEASIBLE → silent
// greedy fallback). The solver's accumulator domains are now horizon-derived
// so this no longer risks infeasibility, but clamping keeps the penalty
// meaningful and bounded. (audit fix C4)
//
// NOTE: `initial_fatigue_score` is now a DISPLAY/compat field only — the
// solver prefers `initial_effective_minutes` (audit F-07).
const MAX_INITIAL_FATIGUE_SCORE = 60;

/**
 * Prior circadian load, in the solver's own effective-minute unit, that spills
 * into the first week of the horizon (audit F-07 / F-18).
 *
 * SC-7 buckets effective minutes per ISO week. The only prior load the earliest
 * bucket is missing is the employee's work in that SAME ISO week before the
 * horizon starts — so that is exactly what we measure. No conversion constant,
 * no fudge factor, and no dependence on "today": the old code computed a
 * 7-day-trailing fatigue score anchored to the current date, which silently
 * read 0 whenever the roster began far enough in the future that the fetched
 * context didn't overlap the last week at all (F-18), and was fed through a
 * ~2.2×-overstating `× 60` conversion when it didn't (F-07).
 */
function priorEffectiveMinutesForHorizon(
    existing: ExistingShiftRef[],
    horizonStartDate: string,
): number {
    const horizonStart = parseISO(horizonStartDate);
    // ISO weeks start Monday; anything from that Monday up to (not including)
    // the horizon start is load already banked in the first bucket.
    const weekStart = startOfISOWeek(horizonStart);
    let total = 0;
    for (const s of existing) {
        const d = parseISO(s.shift_date);
        if (d >= weekStart && d < horizonStart) {
            total += effectiveMinutes({
                start_time: s.start_time,
                end_time: s.end_time,
                unpaid_break_minutes: s.unpaid_break_minutes,
            });
        }
    }
    return Math.round(total);
}

// Mirrors the Python service guards (ortools_runner.py). Surface to the user
// before we serialize a giant payload and round-trip to the optimizer.
const MAX_OPTIMIZER_SHIFTS = 2000;
const MAX_OPTIMIZER_EMPLOYEES = 500;

export class AutoSchedulerInputTooLargeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AutoSchedulerInputTooLargeError';
    }
}

// =============================================================================
// INPUT / OPTIONS
// =============================================================================

export interface AutoSchedulerInput {
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    /**
     * Employment-mode partition (ICC Sydney EBA 2025).
     * Defaults to 'ALL' (mixed pool). When 'FT_STANDARD', strictly isolates
     * Standard Non-Security Full-Time shifts & employees (cl 35.1, 12.2),
     * skips the Casual Fairness Ledger, sizes HC-7 demand on NET paid minutes,
     * and enforces 1-shift/day + SC-13 paired consecutive RDOs.
     */
    mode?: SchedulerMode;
    employeeDetails?: Map<string, Partial<OptimizerEmployee>>;
    constraints?: OptimizerConstraints;
    strategy?: OptimizerStrategy;
    timeLimitSeconds?: number;
    numWorkers?: number;
    /** Allows the caller to abort an in-flight run before it overwrites state. */
    signal?: AbortSignal;
    /**
     * Org scope for the casual fairness ledger. When provided, the optimizer
     * reads each casual's opportunity-adjusted debts and biases the roster
     * toward whoever is owed work. When ABSENT, the ledger is cleanly skipped.
     * The ledger is recomputed nightly from approved billables, never here.
     */
    organizationId?: string;
    /** B4 — when true, the solver also returns Pareto "what-if" alternatives
     *  (cheapest / most-balanced) for the trade-off explorer. Adds solve time,
     *  so the UI requests it explicitly. */
    computeAlternatives?: boolean;
}

interface CommitResult {
    success: boolean;
    totalCommitted: number;
    failedEmployees: string[];
    concurrencyConflicts: string[];   // Shift IDs that failed the recheck
    /**
     * The RPC's own reason for a failed commit (`SQLERRM` from
     * sm_bulk_assign_atomic's exception handler, or its authorization message).
     * The committer has always captured this; it was dropped here, so a
     * trigger rejection surfaced to the user as the generic "check compliance
     * results" — pointing at the one layer that had passed. Undefined on
     * success.
     */
    message?: string;
}

// =============================================================================
// FALLBACK: Greedy Incremental Assignment
// =============================================================================

/**
 * The employment basis the solver's HC-5c compares against
 * `shift.target_employment_type`. The raw contract status wins: in prod 17 of
 * 122 staff have a `profiles.employment_type` that disagrees with their Active
 * contract, and the DB trigger compares against the contract.
 * `toTargetEmploymentType` mirrors the solver's `normalize_employment_type()`.
 */
function solverEmploymentType(e: EmployeeMeta): string {
    if (e.employment_status) return toTargetEmploymentType(e.employment_status);
    if (/casual/i.test(e.contract_type || '')) return 'Casual';
    return e.contract_type === 'PT' || /part/i.test(e.contract_type || '') ? 'Part-Time' : 'Full-Time';
}

/** ICC EBA cl 35.1(c)-(d) — Standard Full-Time daily net ordinary hours bounds. */
const FT_MIN_DAILY_NET_MINUTES = 456; // 7.6h
const FT_MAX_DAILY_NET_MINUTES = 720; // 12.0h

/**
 * ICC EBA cl 12.3(e), cl 35.2(d)-(e), cl 56.2 & Sch 3 §5.2(d)-(e) — Regular
 * Part-Time daily worked/paid duration bounds:
 *   - 3.0h (180m) flat minimum engagement on weekdays, Sundays, and training
 *     (no 2h training exception and no 4h Sunday uplift for plain PT)
 *   - 4.0h (240m) minimum engagement on Public Holidays (cl 56.2)
 *   - 12.0h (720m) daily ordinary hours ceiling
 */
export const PT_MIN_ENGAGEMENT_MINUTES = 180;
export const PT_PH_MIN_ENGAGEMENT_MINUTES = 240;
export const PT_MAX_DAILY_NET_MINUTES = 720;

/**
 * ICC EBA cl 12.4(c), cl 35.3(d)-(g) & cl 56.2 — Flexible Part-Time daily worked/paid bounds:
 *   - 2.0h (120m) minimum engagement for training/meeting on non-event day (cl 12.4(c)(i), cl 35.3(f)(i))
 *   - 4.0h (240m) minimum engagement on Sunday or Public Holiday (cl 12.4(c)(iii), cl 35.3(f)(iii), cl 56.2)
 *   - 3.0h (180m) minimum engagement on standard weekday (cl 12.4(c)(iv), cl 35.3(f)(iv))
 *   - 12.0h (720m) daily ordinary hours ceiling (cl 35.3(d))
 *   - 10 consecutive days maximum work streak without a day off (cl 35.3(g))
 */
export const FPT_MIN_ENGAGEMENT_MINUTES = 180;
export const FPT_TRAINING_MIN_ENGAGEMENT_MINUTES = 120;
export const FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES = 240;
export const FPT_MAX_DAILY_NET_MINUTES = 720;
export const FPT_MAX_CONSECUTIVE_DAYS = 10;

/**
 * ICC EBA cl 12.5(c), cl 35.4(c)-(f), cl 56.2 & Sch 3 §5.3 — Casual daily worked/paid bounds:
 *   - 2.0h (120m) minimum engagement for training/meeting on non-event day (cl 12.5(c)(i))
 *   - 4.0h (240m) minimum engagement on Sunday (cl 12.5(c)(ii))
 *   - 4.0h (240m) minimum engagement on Public Holiday (cl 56.2)
 *   - 3.0h (180m) minimum engagement on standard weekday (cl 12.5(c)(iii))
 *   - 4.0h (240m) minimum engagement for Event Security on ANY day (Sch 3 §5.3(e))
 *   - 3.0h (180m) minimum engagement per shift for Event Security working 2 shifts in a day (Sch 3 §5.3(g))
 *   - 12.0h (720m) daily ordinary hours ceiling (cl 35.4(c))
 *   - Maximum 2 engagements starting on any one calendar day (cl 35.4(f))
 */
export const CASUAL_MIN_ENGAGEMENT_MINUTES = 180;
export const CASUAL_TRAINING_MIN_ENGAGEMENT_MINUTES = 120;
export const CASUAL_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES = 240;
export const CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES = 240;
export const CASUAL_MAX_DAILY_NET_MINUTES = 720;
export const CASUAL_MAX_DAILY_ENGAGEMENTS = 2;

/**
 * Net paid/worked minutes of a shift (cl 36.1 deducts unpaid meal breaks for
 * general staff; Sch 3 §3.2(a) pays meal breaks on the clock for Security).
 */
export function shiftNetMinutes(
    s: Pick<ShiftMeta, 'start_time' | 'end_time' | 'unpaid_break_minutes'>,
    isSecurity = false,
): number {
    const gross = durationMinutes(s.start_time, s.end_time);
    return isSecurity ? gross : Math.max(0, gross - (s.unpaid_break_minutes ?? 0));
}

/**
 * Layer 1 shift filter for `FT_STANDARD`:
 *   - Must target Full-Time (`'FT'`) or unscoped (`null`/`undefined`)
 *   - Must NOT require flexible part-time (`target_requires_flexible`)
 *   - Must NOT be a Schedule 3 Security shift (`isSecurityRoleName`)
 */
export function isStandardFtShift(
    s: Pick<ShiftMeta, 'target_employment_type' | 'target_requires_flexible' | 'roleName'>,
): boolean {
    if (s.target_employment_type && s.target_employment_type !== 'FT') return false;
    if (s.target_requires_flexible) return false;
    if (isSecurityRoleName(s.roleName)) return false;
    return true;
}

/**
 * Layer 1 employee filter for `FT_STANDARD`:
 *   - Substantive engagement is Full-Time (`isFullTimeEmployee`)
 *   - Not Flexible (`!is_flexible`)
 *   - Not Schedule 3 Security (`!isSecurityRole` — belongs to `FT_SECURITY`)
 */
export function isStandardFtEmployee(
    e: EmployeeMeta,
    opts?: { isSecurityRole?: boolean },
): boolean {
    if (!isFullTimeEmployee(e.employment_status, e.contract_type)) return false;
    if (e.is_flexible) return false;
    if (opts?.isSecurityRole) return false;
    return true;
}

/**
 * Layer 1 shift filter for `FT_SECURITY` (ICC EBA Schedule 3 §3.1):
 *   - Must be a Schedule 3 Security shift (`isSecurityRoleName`)
 *   - Must target Full-Time (`'FT'`) or unscoped (`null`/`undefined`)
 *   - Must NOT require flexible part-time (`target_requires_flexible`)
 */
export function isFtSecurityShift(
    s: Pick<ShiftMeta, 'target_employment_type' | 'target_requires_flexible' | 'roleName'>,
): boolean {
    if (!isSecurityRoleName(s.roleName)) return false;
    if (s.target_employment_type && s.target_employment_type !== 'FT') return false;
    if (s.target_requires_flexible) return false;
    return true;
}

/**
 * Layer 1 employee filter for `FT_SECURITY` (ICC EBA Schedule 3 §3.1):
 *   - Substantive engagement is Full-Time (`isFullTimeEmployee`)
 *   - Not Flexible (`!is_flexible`)
 *   - Schedule 3 Security (`Boolean(opts?.isSecurityRole)`)
 *   - Excludes Part-Time Event Security (Sch 3 §5.2) & Casual Event Security (§5.3)
 */
export function isFtSecurityEmployee(
    e: EmployeeMeta,
    opts?: { isSecurityRole?: boolean },
): boolean {
    if (!isFullTimeEmployee(e.employment_status, e.contract_type)) return false;
    if (e.is_flexible) return false;
    if (!opts?.isSecurityRole) return false;
    return true;
}

/**
 * Layer 1 shift filter for `PT` (Regular / Predetermined Part-Time — ICC EBA
 * cl 12.3 & cl 35.2, plus Schedule 3 §5.2 Event Security Part-Time):
 *   - Must target Part-Time (`'PT'`) or unscoped (`null`/`undefined`)
 *   - Must NOT require Flexible Part-Time (`target_requires_flexible` belongs to `FPT`)
 *   - Includes BOTH Standard PT and Event Security PT shifts
 */
export function isPtShift(
    s: Pick<ShiftMeta, 'target_employment_type' | 'target_requires_flexible'>,
): boolean {
    if (s.target_employment_type && s.target_employment_type !== 'PT') return false;
    if (s.target_requires_flexible) return false;
    return true;
}

/**
 * Layer 1 employee filter for `PT` (Regular / Predetermined Part-Time — ICC EBA
 * cl 12.3 & cl 35.2, plus Schedule 3 §5.2 Event Security Part-Time):
 *   - Substantive engagement resolves to `'PT'` (`resolveEmploymentType`)
 *   - Strictly NOT Flexible Part-Time (`!is_flexible`, `!isFlexibleEmploymentStatus`)
 *   - Includes BOTH Standard PT (`!isSecurityRole`) and Event Security PT (`isSecurityRole`)
 */
export function isPtEmployee(
    e: EmployeeMeta,
    opts?: { isFlexible?: boolean },
): boolean {
    if (resolveEmploymentType(e.employment_status, e.contract_type) !== 'PT') return false;
    if (e.is_flexible || isFlexibleEmploymentStatus(e.employment_status) || opts?.isFlexible) {
        return false;
    }
    return true;
}

/**
 * Layer 1 shift filter for `FPT` (Flexible Part-Time — ICC EBA cl 12.4 & cl 35.3):
 *   - Must target Part-Time (`'PT'`) or unscoped (`null`/`undefined`)
 *   - Must NOT be targeted strictly at Regular Part-Time (`target_employment_type === 'PT' && !target_requires_flexible`)
 *   - Untargeted shifts or shifts with `target_requires_flexible === true` are eligible
 *   - Includes BOTH Standard FPT and Event Security FPT shifts
 */
export function isFptShift(
    s: Pick<ShiftMeta, 'target_employment_type' | 'target_requires_flexible'>,
): boolean {
    if (s.target_employment_type && s.target_employment_type !== 'PT') return false;
    if (s.target_employment_type === 'PT' && !s.target_requires_flexible) return false;
    return true;
}

/**
 * Layer 1 employee filter for `FPT` (Flexible Part-Time — ICC EBA cl 12.4 & cl 35.3):
 *   - Substantive engagement resolves to `'PT'` (`resolveEmploymentType`)
 *   - Strictly Flexible Part-Time (`is_flexible`, `isFlexibleEmploymentStatus`, or `opts?.isFlexible`)
 *   - Includes BOTH Standard FPT (`!isSecurityRole`) and Event Security FPT (`isSecurityRole`)
 */
export function isFptEmployee(
    e: EmployeeMeta,
    opts?: { isFlexible?: boolean },
): boolean {
    if (resolveEmploymentType(e.employment_status, e.contract_type) !== 'PT') return false;
    const isFlex = Boolean(e.is_flexible || isFlexibleEmploymentStatus(e.employment_status) || opts?.isFlexible);
    return isFlex;
}

/**
 * Layer 1 shift filter for `CASUAL` (ICC EBA cl 12.5 & cl 35.4):
 *   - Must target Casual (`'Casual'`) or unscoped (`null`/`undefined`)
 *   - Must NOT require flexible part-time (`target_requires_flexible`)
 *   - Must NOT target Full-Time (`'FT'`) or Part-Time (`'PT'`)
 *   - Includes BOTH Standard Casual and Event Security Casual shifts
 */
export function isCasualShift(
    s: Pick<ShiftMeta, 'target_employment_type' | 'target_requires_flexible'>,
): boolean {
    if (s.target_employment_type && s.target_employment_type !== 'Casual') return false;
    if (s.target_requires_flexible) return false;
    return true;
}

/**
 * Layer 1 employee filter for `CASUAL` (ICC EBA cl 12.5 & cl 35.4):
 *   - Substantive engagement resolves to `'Casual'` (`resolveEmploymentType`)
 *   - Includes BOTH Standard Casual (`!isSecurityRole`) and Event Security Casual (`isSecurityRole`)
 *   - Excludes Full-Time, Regular Part-Time, and Flexible Part-Time
 */
export function isCasualEmployee(e: EmployeeMeta): boolean {
    return resolveEmploymentType(e.employment_status, e.contract_type) === 'Casual';
}

interface ValidationContextMaps {
    leaveByEmployee?: ReadonlyMap<string, string[]>;
    workCycles?: ReadonlyMap<string, { ordinary_hours_cycle_weeks?: number; ordinary_hours_cycle_anchor?: string }>;
    securityRoleIds?: ReadonlySet<string>;
}

/**
 * Hydrate the full V8 `EmployeeInfo` passed into `assignmentValidator.simulate`
 * so `V8_ORD_HOURS_AVG` (anchored 1..4w cycle), `V8_FT_DAYS_OFF`,
 * `V8_LEAVE_CONFLICT`, `V8_STUDENT_VISA_LIMIT`, and Schedule 3 exemptions all
 * evaluate against the employee's real contract instead of defaulting to CASUAL.
 */
function buildInjectedEmployeeInfo(args: {
    employeeId: string;
    employeeName: string;
    emp?: EmployeeMeta;
    details?: Partial<OptimizerEmployee>;
    ctx?: ValidationContextMaps;
}): EmployeeInfo {
    const { employeeId, employeeName, emp, details, ctx } = args;
    const resolvedType = emp
        ? resolveEmploymentType(emp.employment_status, emp.contract_type)
        : null;
    const isFlex = Boolean(
        emp?.is_flexible ||
        (emp?.employment_status && isFlexibleEmploymentStatus(emp.employment_status)) ||
        details?.is_flexible
    );
    const contractType: EmployeeInfo['contract_type'] =
        resolvedType === 'FT' ? 'FT'
        : resolvedType === 'PT' ? (isFlex ? 'FLEXI_PART_TIME' : 'PT')
        : resolvedType === 'Casual' ? 'CASUAL'
        : null;

    const mergedLeave = Array.from(new Set([
        ...(details?.unavailable_dates ?? []),
        ...(ctx?.leaveByEmployee?.get(employeeId) ?? []),
    ]));

    const cycle = ctx?.workCycles?.get(employeeId);
    const isSecurityRole = details?.is_security_role
        ?? (ctx?.securityRoleIds
            ? (emp?.contracted_role_ids ?? []).some(id => ctx.securityRoleIds!.has(id))
            : undefined);

    return {
        id: employeeId,
        name: employeeName,
        contract_type: contractType,
        contracted_weekly_hours: emp?.contracted_weekly_hours || undefined,
        ordinary_hours_cycle_weeks: cycle?.ordinary_hours_cycle_weeks ?? details?.ordinary_hours_cycle_weeks,
        ordinary_hours_cycle_anchor: cycle?.ordinary_hours_cycle_anchor ?? details?.ordinary_hours_cycle_anchor,
        leave_days: mergedLeave.length > 0 ? mergedLeave : undefined,
        is_security_role: isSecurityRole,
        is_student_visa: emp?.is_student ?? details?.is_student,
        contracts: details?.contracts || [],
        qualifications: details?.qualifications || [],
        employment_statuses: emp?.employment_status ? [emp.employment_status] : undefined,
    };
}

/**
 * When OR-Tools is unavailable or returns INFEASIBLE, fall back to a greedy
 * first-fit strategy: iterate employees in load-ascending order, assign each
 * unfilled shift to the first employee that passes compliance simulation.
 *
 * This guarantees the user always gets a usable result and integrates 
 * Fatigue and Fairness (Utilization) into the scoring.
 */
async function greedyFallback(
    shifts: ShiftMeta[],
    employees: EmployeeMeta[],
    employeeDetails: Map<string, Partial<OptimizerEmployee>>,
    existingRoster: Map<string, ExistingShiftRef[]>,
    strategy?: OptimizerStrategy,
    /**
     * Per-employee WINDOW contract obligation in minutes, net of approved
     * leave and before the fair-share cap — see
     * `windowContractObligationMinutes`. Supplied by `run()` so the fallback
     * measures utilization against the same contract basis the solver's HC-7
     * does. Absent (or 0) leaves an employee out of the utilization term
     * entirely, which is the correct reading for casuals.
     */
    windowObligation?: ReadonlyMap<string, number>,
    /** Casual employees' confidence-weighted ledger debts — the solver's `fairness_debts`. */
    fairnessDebts?: ReadonlyMap<string, Partial<Record<FairnessMetric, number>>>,
    validationCtx?: ValidationContextMaps,
    mode: SchedulerMode = 'ALL',
    card?: PricedCard | null,
): Promise<ValidatedProposal[]> {
    const isFtStandard = mode === 'FT_STANDARD';
    const isFtSecurity = mode === 'FT_SECURITY';
    const isFtMode = isFtStandard || isFtSecurity;
    const isPtMode = mode === 'PT';
    const isFptMode = mode === 'FPT';
    const isCasualMode = mode === 'CASUAL';
    const isPermanentMode = isFtMode || isPtMode || isFptMode;
    const cardLoadings = card?.loadings;
    const dailyCapMins = (isSec: boolean) => cardLoadings
        ? Math.round((isSec ? cardLoadings.securityOrdinaryCapHours : cardLoadings.ordinaryDailyCapHours) * 60)
        : FT_MAX_DAILY_NET_MINUTES;
    const solverConfig: SolverConfig | undefined = cardLoadings ? v8ConfigFromLoadings(cardLoadings) : undefined;
    // Resolve strategy once here with the same defaults used when building
    // the Python optimizer request (see OptimizeRequest construction below).
    // This ensures the greedy fallback honours UI slider values instead of
    // always using baked-in constants.
    const resolvedStrategy = strategy ?? {
        fatigue_weight: 50,
        fairness_weight: 50,
        cost_weight: 50,
        coverage_weight: 100,
    };
    const proposals: ValidatedProposal[] = [];
    const assignedByEmployee = new Map<string, string[]>();

    for (const emp of employees) {
        assignedByEmployee.set(emp.id, []);
    }

    // First day of the optimization window. `existingRoster` deliberately
    // reaches 28 days BEHIND it to give the rest-gap and fatigue checks their
    // rolling context, so history must be excluded from the utilization
    // numerator — counting it against a window-sized denominator reported
    // everyone as massively over-utilized on a short window and never
    // under-utilized on any.
    const windowStartDate = shifts.reduce<string | null>(
        (min, s) => (min === null || s.shift_date < min ? s.shift_date : min),
        null,
    );

    for (const shift of shifts) {
        let assigned = false;
        const netMins = shiftNetMinutes(shift, isFtSecurity);
        const ftMaxDaily = dailyCapMins(isFtSecurity);
        if (isFtMode && (netMins < FT_MIN_DAILY_NET_MINUTES || netMins > ftMaxDaily)) {
            const modePrefix = isFtSecurity ? 'Full-Time Security' : 'Standard Full-Time';
            proposals.push({
                shiftId: shift.id,
                employeeId: '',
                employeeName: '',
                shiftDate: shift.shift_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                optimizerCost: 0,
                employmentType: 'Full-Time',
                complianceStatus: 'FAIL',
                violations: [{
                    type: netMins < FT_MIN_DAILY_NET_MINUTES ? 'FT_MIN_DAILY_HOURS' : 'MAX_DAILY_HOURS',
                    ruleName: netMins < FT_MIN_DAILY_NET_MINUTES ? 'FT Minimum Daily Hours (cl 35.1(c))' : 'FT Maximum Daily Hours (cl 35.1(d) / Sch 3 §3.1(a))',
                    description: netMins < FT_MIN_DAILY_NET_MINUTES
                        ? `${modePrefix} shift paid duration (${(netMins / 60).toFixed(1)}h) is below the 7.6h minimum (ICC EBA cl 35.1(c)).`
                        : `${modePrefix} shift paid duration (${(netMins / 60).toFixed(1)}h) exceeds the ${(ftMaxDaily / 60).toFixed(1)}h maximum (ICC EBA cl 35.1(d) / Sch 3 §3.1(a)).`,
                    blocking: true,
                }],
                passing: false,
            });
            continue;
        }
        // The ledger's own category split (Sat/Sun/PH/night 22:00–06:00), so the
        // fallback prices this shift exactly as the solver's SC-11/SC-11b do.
        const shiftMinutes = categoryMinutes(
            shift.shift_date,
            shift.start_time,
            shift.end_time,
            netMins,
        );

        const shiftDayType = getShiftDayType(shift.shift_date, card?.jurisdiction);
        const minStd = cardLoadings?.minEngagementMinutes ?? PT_MIN_ENGAGEMENT_MINUTES;
        const minSun = cardLoadings?.minEngagementSundayMinutes ?? FPT_SUNDAY_PH_MIN_ENGAGEMENT_MINUTES;
        const minPh  = cardLoadings?.minEngagementPublicHolidayMinutes ?? PT_PH_MIN_ENGAGEMENT_MINUTES;
        const minTr  = cardLoadings?.minEngagementTrainingMinutes ?? FPT_TRAINING_MIN_ENGAGEMENT_MINUTES;
        const ptMinReq = shiftDayType.isPublicHoliday ? minPh : minStd;
        const fptMinReq = (shift as any).is_training
            ? minTr
            : shiftDayType.isPublicHoliday
                ? minPh
                : shiftDayType.isSunday
                    ? minSun
                    : minStd;
        const casualMinReq = (shift as any).is_training
            ? minTr
            : shiftDayType.isPublicHoliday
                ? minPh
                : shiftDayType.isSunday
                    ? minSun
                    : minStd;

        // Score each employee for this shift
        const candidateScores = employees.map(emp => {
            const currentAssignments = assignedByEmployee.get(emp.id) ?? [];
            const existingShifts = existingRoster.get(emp.id) ?? [];
            const details = employeeDetails.get(emp.id);
            const empIsSec = Boolean(
                details?.is_security_role
                    ?? (emp as any).is_security_role
                    ?? (validationCtx?.securityRoleIds
                        ? (emp.contracted_role_ids ?? []).some(id => validationCtx.securityRoleIds!.has(id))
                        : false),
            );
            
            // Map assigned IDs back to shift data for the health utilities
            // This is a bit expensive in O(S) but necessary for a smart fallback
            const totalShiftsForEmp = [
                ...existingShifts,
                ...currentAssignments.map(id => {
                    const s = shifts.find(x => x.id === id);
                    return s ? {
                        id: s.id,
                        shift_date: s.shift_date,
                        start_time: s.start_time,
                        end_time: s.end_time,
                        // Was omitted, and the utilization sum below reads it.
                        // Resolved with the SAME helper `ExistingShiftRef`
                        // uses, so a shift contributes identically whether it
                        // was already committed or proposed by this run.
                        duration_minutes: isFtStandard
                            ? shiftNetMinutes(s, false)
                            : isFtSecurity
                                ? shiftNetMinutes(s, true)
                                : (isPtMode || isFptMode || isCasualMode)
                                    ? shiftNetMinutes(s, empIsSec)
                                    : durationMinutes(s.start_time, s.end_time),
                        unpaid_break_minutes: s.unpaid_break_minutes
                    } : null;
                }).filter(Boolean)
            ];

            // 1. Fatigue Score
            const health = calculateFatigueWithRecovery(
                totalShiftsForEmp as any,
                shift.shift_date,
                { start_time: shift.start_time, end_time: shift.end_time, unpaid_break_minutes: shift.unpaid_break_minutes }
            );

            // 2. Utilization Score.
            const contractedMins = windowObligation?.get(emp.id) ?? 0;
            const scheduledMins = inWindowScheduledMinutes(
                totalShiftsForEmp as { shift_date?: string; duration_minutes?: number }[],
                windowStartDate,
            );

            // Strategy multipliers — `strategyMult` is the shared mirror of
            // optimizer-service/model_builder.py `_strategy_mult`.
            const fairnessWeight = resolvedStrategy.fairness_weight ?? 50;
            const fatigueMult  = strategyMult(resolvedStrategy.fatigue_weight ?? 50);
            const fairnessMult = strategyMult(fairnessWeight);

            const fatiguePenalty = health.projected > FATIGUE_BANDS.OK_MAX
                ? Math.pow(health.projected - FATIGUE_BANDS.OK_MAX, 2) * 50 * fatigueMult
                : 0;
            const { utilization: utl, penalty: utilizationPenalty, bonus: fairnessBonus } =
                greedyUtilizationTerms(scheduledMins, contractedMins, fairnessMult);

            // Casual ledger bias — disabled in permanent modes (casual-only module).
            const debtBonus = isPermanentMode
                ? 0
                : -shiftFairnessPenaltyCents(fairnessDebts?.get(emp.id), shiftMinutes, fairnessWeight);

            const pref = new Set(details?.preferred_shift_ids || []);
            const preferenceBonus = pref.has(shift.id) ? 50 : 0; // base preference bonus ($5.00 equivalent)

            const score = 1000 - fatiguePenalty - utilizationPenalty + fairnessBonus + debtBonus + preferenceBonus;

            return { 
                emp, 
                empIsSec,
                score, 
                fatigueScore: health.projected,
                utilization: utl,
                totalShiftsForEmp,
            };
        });

        // Try employees in order of highest score
        const sorted = candidateScores
            .filter(c => {
                // Role-set eligibility — mirrors the solver's employee_eligible
                // and the manual/bulk R10 rule: an employee may work a shift only
                // if they hold a contract for the shift's role.
                if (shift.role_id) {
                    const roles = c.emp.contracted_role_ids ?? [];
                    if (!roles.includes(shift.role_id)) return false;
                }

                // cl 35.1(e) / cl 39.1 / trg_shift_ft_one_per_day: Full-Time
                // works continuously on at most one shift per calendar day.
                if (isFtMode) {
                    const hasSameDay = c.totalShiftsForEmp.some(
                        s => (s as { shift_date?: string } | null)?.shift_date === shift.shift_date,
                    );
                    if (hasSameDay) return false;
                }

                // cl 12.3(e) / cl 35.2(d)-(e) / cl 56.2 / Sch 3 §5.2(d)-(e):
                // Regular Part-Time worked/paid bounds per employee (unpaid meal
                // break subtracted for Standard PT, paid meal break kept for
                // Event Security PT per Sch 3 §5.3(a)).
                if (isPtMode) {
                    const workedMins = shiftNetMinutes(shift, c.empIsSec);
                    if (workedMins < ptMinReq || workedMins > dailyCapMins(c.empIsSec)) {
                        return false;
                    }
                }

                // cl 12.4(c) / cl 35.3(d)-(f) / cl 56.2:
                // Flexible Part-Time worked/paid bounds per employee (unpaid meal
                // break subtracted for Standard FPT, paid meal break kept for
                // Event Security FPT per Sch 3 §5.3(a)).
                if (isFptMode) {
                    const workedMins = shiftNetMinutes(shift, c.empIsSec);
                    if (workedMins < fptMinReq || workedMins > dailyCapMins(c.empIsSec)) {
                        return false;
                    }
                }

                // cl 35.4(f) & cl 12.5(c) / cl 35.4(c) / cl 56.2 / Sch 3 §5.3:
                // Casual worked/paid bounds and max 2 daily engagements.
                if (isCasualMode) {
                    const sameDayShifts = c.totalShiftsForEmp.filter(
                        s => (s as any)?.shift_date === shift.shift_date && !(s as any)?.is_training,
                    );
                    if (sameDayShifts.length >= CASUAL_MAX_DAILY_ENGAGEMENTS) {
                        return false;
                    }
                    const workedMins = shiftNetMinutes(shift, c.empIsSec);
                    const minReq = c.empIsSec ? CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES : casualMinReq;
                    if (workedMins < minReq || workedMins > dailyCapMins(c.empIsSec)) {
                        return false;
                    }
                }
                
                return true;
            })
            .sort((a, b) => b.score - a.score);

        if (sorted.length === 0) {
            console.debug('[AutoScheduler] No eligible employees for shift %s (Role/Skill mismatch)', shift.id);
        }

        for (const candidate of sorted) {
            const { emp } = candidate;
            
            const existingV8ShiftIds = assignedByEmployee.get(emp.id) ?? [];
            const candidateIds = [...existingV8ShiftIds, shift.id];

            try {
                // Build injected context from pre-fetched maps
                const details = employeeDetails.get(emp.id);
                const existing = existingRoster.get(emp.id) ?? [];
                
                // Only simulate if they passed the basic pre-filters above
                const simResult = await assignmentValidator.simulate(
                    candidateIds,
                    emp.id,
                    { 
                        mode: 'PARTIAL_APPLY',
                        solverConfig,
                        injectedData: {
                            candidateShifts: shifts.filter(s => candidateIds.includes(s.id)) as any,
                            existingShifts: existing.map(e => ({
                                id: e.id,
                                shift_date: e.shift_date,
                                start_time: e.start_time,
                                end_time: e.end_time,
                                assigned_employee_id: emp.id,
                                unpaid_break_minutes: e.unpaid_break_minutes ?? 0,
                                paid_break_minutes: e.paid_break_minutes ?? 0,
                            })) as any,
                            employee: buildInjectedEmployeeInfo({
                                employeeId: emp.id,
                                employeeName: emp.name,
                                emp,
                                details,
                                ctx: validationCtx,
                            }),
                        }
                    },
                );
                const shiftResult = simResult.results.find(r => r.shiftId === shift.id);
                if (shiftResult?.passing) {
                    assignedByEmployee.get(emp.id)!.push(shift.id);
                    const empResolved = resolveEmploymentType(emp.employment_status, emp.contract_type);
                    proposals.push({
                        shiftId: shift.id,
                        employeeId: emp.id,
                        employeeName: emp.name,
                        shiftDate: shift.shift_date,
                        startTime: shift.start_time,
                        endTime: shift.end_time,
                        optimizerCost: 0,
                        employmentType: empResolved === 'Casual' ? 'Casual' : empResolved === 'PT' ? 'Part-Time' : 'Full-Time',
                        complianceStatus: 'PASS',
                        violations: [],
                        passing: true,
                        fatigueScore: candidate.fatigueScore,
                        utilization: candidate.utilization,
                    });
                    assigned = true;
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!assigned) {
            const ptWorkedRef = isPtMode
                ? shiftNetMinutes(shift, isSecurityRoleName(shift.roleName))
                : 0;
            const ptBelowMin = isPtMode && candidateScores.every(c => shiftNetMinutes(shift, c.empIsSec) < ptMinReq);
            const ptAboveMax = isPtMode && candidateScores.every(c => shiftNetMinutes(shift, c.empIsSec) > dailyCapMins(c.empIsSec));

            const fptWorkedRef = isFptMode
                ? shiftNetMinutes(shift, isSecurityRoleName(shift.roleName))
                : 0;
            const fptBelowMin = isFptMode && candidateScores.every(c => shiftNetMinutes(shift, c.empIsSec) < fptMinReq);
            const fptAboveMax = isFptMode && candidateScores.every(c => shiftNetMinutes(shift, c.empIsSec) > dailyCapMins(c.empIsSec));

            const casualWorkedRef = isCasualMode
                ? shiftNetMinutes(shift, isSecurityRoleName(shift.roleName))
                : 0;
            const casualBelowMin = isCasualMode && candidateScores.every(c => {
                const minReq = c.empIsSec ? CASUAL_EVENT_SECURITY_MIN_ENGAGEMENT_MINUTES : casualMinReq;
                return shiftNetMinutes(shift, c.empIsSec) < minReq;
            });
            const casualAboveMax = isCasualMode && candidateScores.every(c => shiftNetMinutes(shift, c.empIsSec) > dailyCapMins(c.empIsSec));

            proposals.push({
                shiftId: shift.id,
                employeeId: '',
                employeeName: '',
                shiftDate: shift.shift_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                optimizerCost: 0,
                employmentType: isFtMode ? 'Full-Time' : (isPtMode || isFptMode) ? 'Part-Time' : 'Casual',
                complianceStatus: 'FAIL',
                violations: ptBelowMin && candidateScores.length > 0 ? [{
                    type: 'MIN_ENGAGEMENT',
                    ruleName: shiftDayType.isPublicHoliday
                        ? 'Public Holiday Minimum Engagement (cl 56.2)'
                        : 'Part-Time Minimum Engagement (cl 12.3(e) / cl 35.2(e))',
                    description: shiftDayType.isPublicHoliday
                        ? `Part-Time shift worked duration (${(ptWorkedRef / 60).toFixed(1)}h) is below the 4.0h Public Holiday minimum (ICC EBA cl 56.2).`
                        : `Part-Time shift worked duration (${(ptWorkedRef / 60).toFixed(1)}h) is below the 3.0h minimum engagement (ICC EBA cl 12.3(e) / cl 35.2(e)).`,
                    blocking: true,
                }] : ptAboveMax && candidateScores.length > 0 ? [{
                    type: 'MAX_DAILY_HOURS',
                    ruleName: 'Part-Time Maximum Daily Hours (cl 35.2(d) / Sch 3 §5.2(d))',
                    description: `Part-Time shift worked duration (${(ptWorkedRef / 60).toFixed(1)}h) exceeds the 12.0h daily ceiling (ICC EBA cl 35.2(d) / Sch 3 §5.2(d)).`,
                    blocking: true,
                }] : fptBelowMin && candidateScores.length > 0 ? [{
                    type: 'MIN_ENGAGEMENT',
                    ruleName: (shift as any).is_training
                        ? 'Training Minimum Engagement (cl 12.4(c)(i) / cl 35.3(f)(i))'
                        : (shiftDayType.isSunday || shiftDayType.isPublicHoliday)
                            ? 'Sunday/PH Minimum Engagement (cl 12.4(c)(iii) / cl 35.3(f)(iii))'
                            : 'Flexible Part-Time Minimum Engagement (cl 12.4(c)(iv) / cl 35.3(f)(iv))',
                    description: (shift as any).is_training
                        ? `Flexible Part-Time training shift worked duration (${(fptWorkedRef / 60).toFixed(1)}h) is below the 2.0h minimum (ICC EBA cl 12.4(c)(i)).`
                        : (shiftDayType.isSunday || shiftDayType.isPublicHoliday)
                            ? `Flexible Part-Time Sunday/PH shift worked duration (${(fptWorkedRef / 60).toFixed(1)}h) is below the 4.0h minimum (ICC EBA cl 12.4(c)(iii)).`
                            : `Flexible Part-Time shift worked duration (${(fptWorkedRef / 60).toFixed(1)}h) is below the 3.0h standard minimum (ICC EBA cl 12.4(c)(iv)).`,
                    blocking: true,
                }] : fptAboveMax && candidateScores.length > 0 ? [{
                    type: 'MAX_DAILY_HOURS',
                    ruleName: 'Flexible Part-Time Maximum Daily Hours (cl 35.3(d))',
                    description: `Flexible Part-Time shift worked duration (${(fptWorkedRef / 60).toFixed(1)}h) exceeds the 12.0h daily ceiling (ICC EBA cl 35.3(d)).`,
                    blocking: true,
                }] : casualBelowMin && candidateScores.length > 0 ? [{
                    type: 'MIN_ENGAGEMENT',
                    ruleName: (shift as any).is_training
                        ? 'Training Minimum Engagement (cl 12.5(c)(i))'
                        : (shiftDayType.isSunday || shiftDayType.isPublicHoliday)
                            ? 'Sunday/PH Minimum Engagement (cl 12.5(c)(ii) / cl 56.2)'
                            : 'Casual Minimum Engagement (cl 12.5(c)(iii) / Sch 3 §5.3(e))',
                    description: (shift as any).is_training
                        ? `Casual training shift worked duration (${(casualWorkedRef / 60).toFixed(1)}h) is below the 2.0h minimum (ICC EBA cl 12.5(c)(i)).`
                        : (shiftDayType.isSunday || shiftDayType.isPublicHoliday)
                            ? `Casual Sunday/PH shift worked duration (${(casualWorkedRef / 60).toFixed(1)}h) is below the 4.0h minimum (ICC EBA cl 12.5(c)(ii) / cl 56.2).`
                            : `Casual shift worked duration (${(casualWorkedRef / 60).toFixed(1)}h) is below the minimum engagement.`,
                    blocking: true,
                }] : casualAboveMax && candidateScores.length > 0 ? [{
                    type: 'MAX_DAILY_HOURS',
                    ruleName: 'Casual Maximum Daily Hours (cl 35.4(c))',
                    description: `Casual shift worked duration (${(casualWorkedRef / 60).toFixed(1)}h) exceeds the 12.0h daily ceiling (ICC EBA cl 35.4(c)).`,
                    blocking: true,
                }] : [{
                    type: 'NO_ELIGIBLE_EMPLOYEE', ruleName: 'No Eligible Employee',
                    description: 'No available employee passed compliance for this shift.', blocking: true,
                }],
                passing: false,
            });
        }
    }

    return proposals;
}

// =============================================================================
// CONTROLLER
// =============================================================================

export class AutoSchedulerController {

    /**
     * Full pipeline: optimize → validate compliance → return preview for manager.
     * Does NOT write to database.
     */
    async run(input: AutoSchedulerInput): Promise<AutoSchedulerResult> {
        // Run-level correlation ID. Logged on every controller line so a
        // user-reported run can be traced from browser → optimizer →
        // commit. The optimizer client generates its own ID for its HTTP
        // call; the two are linked via the [AutoScheduler] Preview ready
        // line which logs both.
        const runId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);

        // ── Layer -1: Request-size guard (matches Python service) ────────────
        // Done before any I/O so the user sees a useful error instead of a
        // late HTTP 400 from the optimizer.
        //
        // Empty is refused too: the window maths below reads dates[0], so no
        // shifts made every scaled weekly cap NaN, which serialises as null.
        if (input.shifts.length === 0) {
            throw new Error('No shifts to schedule in this range — widen the dates or the scope filter.');
        }

        const activeMode: SchedulerMode = input.mode ?? 'ALL';
        const isFtStandard = activeMode === 'FT_STANDARD';
        const isFtSecurity = activeMode === 'FT_SECURITY';
        const isFtMode = isFtStandard || isFtSecurity;
        const isPtMode = activeMode === 'PT';
        const isFptMode = activeMode === 'FPT';
        const isCasualMode = activeMode === 'CASUAL';
        const isPermanentMode = isFtMode || isPtMode || isFptMode;
        const solverMode: SolverSchedulerMode | undefined = activeMode === 'ALL' ? undefined : activeMode;

        // ── Layer -0.5: Mode Partitioning (FT_STANDARD / FT_SECURITY / PT / FPT) ──
        // Best-effort Security role derivation runs against the FULL input batch
        // before filtering so Security role_ids remain known even after Security
        // shifts are removed from `scopedShifts`.
        const securityRoleIds = deriveSecurityRoleIds(input.shifts);
        const scopedShifts = isFtStandard
            ? input.shifts.filter(isStandardFtShift)
            : isFtSecurity
                ? input.shifts.filter(isFtSecurityShift)
                : isPtMode
                    ? input.shifts.filter(isPtShift)
                    : isFptMode
                        ? input.shifts.filter(isFptShift)
                        : isCasualMode
                            ? input.shifts.filter(isCasualShift)
                            : input.shifts;

        if (isFtStandard && scopedShifts.length === 0) {
            throw new Error(
                'No Standard Full-Time shifts to schedule in this range — switch mode or check shift employment targets.',
            );
        }
        if (isFtSecurity && scopedShifts.length === 0) {
            throw new Error(
                'No Full-Time Security shifts to schedule in this range — switch mode or check shift roles and employment targets.',
            );
        }
        if (isPtMode && scopedShifts.length === 0) {
            throw new Error(
                'No Part-Time shifts to schedule in this range — switch mode or check shift employment targets.',
            );
        }
        if (isFptMode && scopedShifts.length === 0) {
            throw new Error(
                'No Flexible Part-Time shifts to schedule in this range — switch mode or check shift employment targets.',
            );
        }
        if (isCasualMode && scopedShifts.length === 0) {
            throw new Error(
                'No Casual shifts to schedule in this range — switch mode or check shift employment targets.',
            );
        }
        if (scopedShifts.length > MAX_OPTIMIZER_SHIFTS) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many shifts (${scopedShifts.length}). The optimizer accepts at most ${MAX_OPTIMIZER_SHIFTS} per run — narrow the date range.`,
            );
        }
        if (input.employees.length > MAX_OPTIMIZER_EMPLOYEES) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many employees (${input.employees.length}). The optimizer accepts at most ${MAX_OPTIMIZER_EMPLOYEES} per run — narrow the scope filter.`,
            );
        }

        // Pre-DB candidate filter: in FT_SECURITY we keep all non-flexible FT
        // staff whose caller-supplied `is_security_role` is not explicitly false
        // so `fetchEmployeeContractDetails` can still discover Schedule 3 status
        // from `user_contracts` before `scopedEmployees` applies the strict check.
        const candidateEmployees = isFtStandard
            ? input.employees.filter(e =>
                isStandardFtEmployee(e, {
                    isSecurityRole: input.employeeDetails?.get(e.id)?.is_security_role
                        ?? (e.contracted_role_ids ?? []).some(id => securityRoleIds.has(id)),
                }))
            : isFtSecurity
                ? input.employees.filter(e =>
                    isFullTimeEmployee(e.employment_status, e.contract_type)
                    && !e.is_flexible
                    && input.employeeDetails?.get(e.id)?.is_security_role !== false)
                : isPtMode
                    ? input.employees.filter(e =>
                        isPtEmployee(e, {
                            isFlexible: input.employeeDetails?.get(e.id)?.is_flexible,
                        }))
                    : isFptMode
                        ? input.employees.filter(e =>
                            isFptEmployee(e, {
                                isFlexible: input.employeeDetails?.get(e.id)?.is_flexible,
                            }))
                        : isCasualMode
                            ? input.employees.filter(isCasualEmployee)
                            : input.employees;

        const throwIfAborted = () => {
            if (input.signal?.aborted) {
                throw new DOMException('AutoScheduler run aborted', 'AbortError');
            }
        };

        const t0 = performance.now();
        console.debug(
            '[AutoScheduler] Starting — mode=%s shifts=%d employees=%d',
            activeMode, scopedShifts.length, candidateEmployees.length,
        );

        // ── Contract-derived classification (compliance audit finding —
        // 2026-08-02): real Schedule 1/2 level, Schedule 3 Security status,
        // and Schedule 4/5/6 apprentice/trainee/SWS category from each
        // employee's Active `user_contracts` row. Caller-supplied
        // `employeeDetails` still wins per-field where present — see
        // `mergeEmployeeDetails`.
        const contractDetails = await rosterFetcher.fetchEmployeeContractDetails(candidateEmployees);
        const employeeDetails = mergeEmployeeDetails(contractDetails, input.employeeDetails);
        throwIfAborted();

        // Finalize employee pool after DB contract classification resolves
        // Schedule 3 Security status (`is_security_role`).
        const resolveIsSecurity = (e: EmployeeMeta): boolean => {
            const det = employeeDetails.get(e.id);
            return det?.is_security_role
                ?? (e as any).is_security_role
                ?? (e.contracted_role_ids ?? []).some(id => securityRoleIds.has(id));
        };
        const scopedEmployees = isFtStandard
            ? candidateEmployees.filter(e => {
                const det = employeeDetails.get(e.id);
                return isStandardFtEmployee(e, { isSecurityRole: resolveIsSecurity(e) }) && !(det?.is_flexible ?? false);
            })
            : isFtSecurity
                ? candidateEmployees.filter(e => {
                    const det = employeeDetails.get(e.id);
                    return isFtSecurityEmployee(e, { isSecurityRole: resolveIsSecurity(e) }) && !(det?.is_flexible ?? false);
                })
                : isPtMode
                    ? candidateEmployees.filter(e => {
                        const det = employeeDetails.get(e.id);
                        return isPtEmployee(e, { isFlexible: det?.is_flexible });
                    })
                    : isFptMode
                        ? candidateEmployees.filter(e => {
                            const det = employeeDetails.get(e.id);
                            return isFptEmployee(e, { isFlexible: det?.is_flexible });
                        })
                        : isCasualMode
                            ? candidateEmployees.filter(isCasualEmployee)
                            : candidateEmployees;

        // ── Layer 0: Demand-vs-supply pre-check ──────────────────────────────
        // Cheap arithmetic check before we burn CPU on the solver. Surfaces
        // mathematically-impossible days (more shift-hours than worker-hours)
        // that would otherwise just appear as silently uncovered shifts.
        const capacityCheck = this._capacityCheck(scopedShifts, scopedEmployees, employeeDetails);
        if (!capacityCheck.sufficient) {
            console.warn(
                '[AutoScheduler] Capacity deficit detected on %d day(s) — total deficit %d min',
                capacityCheck.deficitDays.length,
                capacityCheck.deficitDays.reduce((a, d) => a + d.deficitMinutes, 0),
            );
        }

        // ── Roster awareness: fetch existing committed shifts ────────────────
        const existingRoster = await rosterFetcher.fetchExistingRoster(
            scopedShifts, scopedEmployees,
        );
        // ── Availability awareness: fetch declared slots ─────────────────────
        const availabilityData = await rosterFetcher.fetchAvailability(
            scopedShifts, scopedEmployees,
        );
        // ── Leave awareness (audit F1): approved leave = LEGAL-HARD ──────────
        const leaveByEmployee = await rosterFetcher.fetchApprovedLeave(
            scopedShifts, scopedEmployees,
        );
        // ── Pending leave: SOFT, not hard ────────────────────────────────────
        const pendingLeaveByEmployee = await rosterFetcher.fetchPendingLeave(
            scopedShifts, scopedEmployees,
        );
        // Employee-declared exceptions
        const exceptionsByEmployee = await rosterFetcher.fetchAvailabilityExceptions(
            scopedShifts, scopedEmployees,
        );
        throwIfAborted();

        // Contract ordinary-hours envelopes (solver HC-5e).
        const envelopes = await rosterFetcher.fetchOrdinaryHoursEnvelopes(scopedEmployees);
        throwIfAborted();
        // Declared cl 35.x(a) work cycle (solver HC-4), resolved as V8 resolves it.
        const workCycles = await rosterFetcher.fetchOrdinaryHoursCycles(scopedEmployees);
        throwIfAborted();
        const totalExisting = Array.from(existingRoster.values())
            .reduce((acc, list) => acc + list.length, 0);
        if (totalExisting > 0) {
            console.debug(
                '[AutoScheduler] Roster context: %d existing shifts across %d employees',
                totalExisting, existingRoster.size,
            );
        }

        // ── Layer 0.5: Past shift identification ─────────────────────────────
        // Shifts that have already started can never be assigned. They skip
        // the solver AND the greedy fallback, and surface as blocking
        // violations so the user sees why they were not assigned.
        const now = Date.now();
        const pastShifts: ShiftMeta[] = [];
        const futureShifts: ShiftMeta[] = [];

        for (const s of scopedShifts) {
            // Re-use logic from IncrementalValidator but on ShiftMeta.
            // ShiftMeta has no start_at, so resolve the authored Sydney
            // wall-clock (shift_date + start_time) to an absolute instant.
            const start = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
            if (start.getTime() <= now) {
                pastShifts.push(s);
            } else {
                futureShifts.push(s);
            }
        }

        if (pastShifts.length > 0) {
            console.debug('[AutoScheduler] Excluding %d past shifts from optimizer', pastShifts.length);
        }

        // Failed-proposal stubs for the excluded shifts — appended to every
        // result path (optimizer and greedy) so UI accounting stays complete.
        const UNSCHEDULABLE_LABEL: Record<'PAST_SHIFT', string> = {
            PAST_SHIFT: 'Shift Already Started',
        };

        const unschedulableProposal = (s: ShiftMeta, type: 'PAST_SHIFT', description: string): ValidatedProposal => ({
            shiftId: s.id,
            employeeId: '',
            employeeName: '',
            shiftDate: s.shift_date,
            startTime: s.start_time,
            endTime: s.end_time,
            optimizerCost: 0,
            employmentType: isFtMode ? 'Full-Time' : (isPtMode || isFptMode) ? 'Part-Time' : 'Casual',
            complianceStatus: 'FAIL',
            violations: [{ type, ruleName: UNSCHEDULABLE_LABEL[type], description, blocking: true }],
            passing: false,
        });
        const excludedProposals: ValidatedProposal[] = [
            ...pastShifts.map(s => unschedulableProposal(s, 'PAST_SHIFT', 'This shift has already started and cannot be assigned.')),
        ];
        const excludedShiftIds = excludedProposals.map(p => p.shiftId);

        // ── Layer 1: Build optimizer request ─────────────────────────────────
        const dates = scopedShifts.map(s => s.shift_date).sort();
        const start = new Date(dates[0]);
        const end = new Date(dates[dates.length - 1]);
        const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const weekScale = diffDays / 7;

        console.debug('[AutoScheduler] Scaling limits for %f week(s) (%d days)', weekScale.toFixed(2), diffDays);

        // The organization's published rate card in force at the window's start
        // drives holiday jurisdiction, candidate rates, split-shift allowance,
        // solver pricing/threshold policy, and V8 daily caps. No card ⇒ refuse
        // rather than price at another organization's — or ICC's — rates.
        const orgId = input.organizationId;
        let rateCards: RateCardSchedule | undefined;
        let windowCard: PricedCard | null = null;
        if (orgId) {
            rateCards = (await fetchPublishedRateCardSchedules([orgId])).get(orgId) ?? [];
            windowCard = resolveCardOn(rateCards, dates[0]);
            if (!windowCard) {
                throw new Error(
                    `No published pay rate card covers ${dates[0]} for this organization. ` +
                    'Publish one in Payroll → Pay Rates, then run the AutoScheduler again.',
                );
            }
        }
        const v8SolverConfig: SolverConfig | undefined = windowCard ? v8ConfigFromLoadings(windowCard.loadings) : undefined;

        const optimizerShifts: OptimizerShift[] = futureShifts.map(s => {
            const dayType = getShiftDayType(s.shift_date, windowCard?.jurisdiction);
            return {
                id: s.id,
                shift_date: s.shift_date,
                start_time: s.start_time,
                end_time: s.end_time,
                duration_minutes: durationMinutes(s.start_time, s.end_time),
                role_id: s.role_id,
                priority: s.demand_source === 'baseline' ? 10 : 1, // Prioritize baseline shifts
                demand_source: s.demand_source,
                target_employment_type: s.target_employment_type,
                target_requires_flexible: s.target_requires_flexible ?? false,
                sub_department_id: s.sub_department_id ?? null,
                level: s.level ?? 0,
                is_training: (s as any).is_training ?? false,
                unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
                paid_break_minutes: s.paid_break_minutes ?? 0,
                is_sunday: dayType.isSunday,
                is_public_holiday: dayType.isPublicHoliday,
                is_public_holiday_next_day: getShiftDayType(shiftDate(s.shift_date, 1), windowCard?.jurisdiction).isPublicHoliday,
            };
        });

        // Total demand across the window — in `FT_STANDARD`, sum NET paid
        // minutes (cl 36.1 unpaid meal breaks excluded); in `FT_SECURITY`, sum
        // PAID minutes (Sch 3 §3.2(a) meal breaks are paid = gross duration);
        // in `PT` & `FPT`, sum worked/paid minutes per shift role (cl 36.1 vs Sch 3 §5.3(a)).
        const totalDemandMinutes = futureShifts.reduce(
            (acc, s) => acc + (isFtStandard
                ? shiftNetMinutes(s, false)
                : isFtSecurity
                    ? shiftNetMinutes(s, true)
                    : (isPtMode || isFptMode || isCasualMode)
                        ? shiftNetMinutes(s, isSecurityRoleName(s.roleName))
                        : durationMinutes(s.start_time, s.end_time)),
            0,
        );

        const weeklyContractMinutes = new Map<string, number>(
            scopedEmployees.map(e => [
                e.id,
                isPtMode
                    ? resolvePtWeeklyContractMinutes(e, employeeDetails.get(e.id)?.min_contract_minutes)
                    : isFptMode
                        ? resolveFptWeeklyContractMinutes(e, employeeDetails.get(e.id)?.min_contract_minutes)
                        : isCasualMode
                            ? 0
                            : (employeeDetails.get(e.id)?.min_contract_minutes
                            ?? baselineWeeklyContractMinutes(isFtMode ? 'FT' : e.contract_type, {
                                isSecurityRole: resolveIsSecurity(e),
                                isFlexible: Boolean(e.is_flexible || employeeDetails.get(e.id)?.is_flexible),
                            })),
            ]),
        );
        const fairShareCaps = buildFairShareCaps(totalDemandMinutes, weeklyContractMinutes);

        const windowObligationMinutes = new Map<string, number>(
            scopedEmployees.map(e => [
                e.id,
                windowContractObligationMinutes(
                    weeklyContractMinutes.get(e.id) ?? 0,
                    weekScale,
                    (leaveByEmployee.get(e.id) ?? []).length,
                ),
            ]),
        );

        // Casual fairness ledger: fairness is casual-only. In permanent modes
        // (`FT_STANDARD` / `FT_SECURITY` / `PT`), skip outright with `'not_applicable'`.
        const casualIds = new Set(
            scopedEmployees.filter(e => solverEmploymentType(e) === 'Casual').map(e => e.id),
        );
        let debtsMap: Map<string, Partial<Record<FairnessMetric, number>>> | undefined;
        let ledgerStatus: FairnessLedgerRunStatus = isPermanentMode
            ? { applied: false, reason: 'not_applicable', employeesWithDebts: 0, windowEnd: null, ageDays: null }
            : { applied: false, reason: 'no_org_scope', employeesWithDebts: 0, windowEnd: null, ageDays: null };
        if (!isPermanentMode && orgId && casualIds.size === 0) {
            ledgerStatus = { applied: false, reason: 'no_data', employeesWithDebts: 0, windowEnd: null, ageDays: null };
        } else if (!isPermanentMode && orgId) {
            try {
                // Org-wide, filtered below: hundreds of casual ids in an `.in()`
                // filter overrun the request URL.
                const read = await fairnessLedgerService.getStandingsWithStatus(orgId, null);
                debtsMap = effectiveDebtsByEmployee(read.standings.filter(s => casualIds.has(s.employeeId)));
                ledgerStatus = {
                    applied: read.status !== 'unavailable',
                    reason: read.status === 'unavailable' ? 'no_data' : read.status,
                    employeesWithDebts: debtsMap.size,
                    windowEnd: read.windowEnd,
                    ageDays: read.ageDays,
                };
                console.debug(
                    '[AutoScheduler] Fairness ledger: %s (%d employees, window_end=%s, %s days old)',
                    ledgerStatus.reason, ledgerStatus.employeesWithDebts,
                    read.windowEnd ?? 'none', read.ageDays ?? 'n/a',
                );
            } catch (err) {
                console.warn('[AutoScheduler] Failed to fetch fairness ledger, continuing without it:', err);
                ledgerStatus = {
                    applied: false, reason: 'fetch_failed',
                    employeesWithDebts: 0, windowEnd: null, ageDays: null,
                };
            }
        }

        const windowRateSet = windowCard?.rateSet ?? resolveRateSet(dates[0]);

        const optimizerEmployees: OptimizerEmployee[] = scopedEmployees.map(e => {
            const det = employeeDetails.get(e.id);
            const resolvedType = resolveEmploymentType(e.employment_status, e.contract_type);
            const isFT = isFullTimeEmployee(e.employment_status, e.contract_type);
            const isPT = resolvedType === 'PT' || e.contract_type === 'PT' || /part/i.test(e.contract_type || '');
            const isCasual = isCasualMode || resolvedType === 'Casual' || (!isFT && !isPT && /casual/i.test(e.contract_type || ''));

            const isSecurityEmployee = resolveIsSecurity(e);
            const securityRate = resolveSecurityAnnualisedRate(windowRateSet, {
                isFullTime: isFT, isSecurityEmployee, level: det?.level,
            });

            // Sch 3 §3.1(d): FT Security works 42h/wk (2520m) averaged over 8w;
            // Standard FT works 38h/wk (2280m); PT honours predetermined contract
            // (>= 20h/wk = 1200m); FPT cl 35.3(e) up to 38h/wk cycle average; Casual 40h/wk (2400m).
            const isFPT = isFptMode || (isPT && Boolean(e.is_flexible || det?.is_flexible || isFlexibleEmploymentStatus(e.employment_status)));
            const fptContractWeekly = weeklyContractMinutes.get(e.id) ?? FPT_WEEKLY_CONTRACT_MINUTES;
            const ptContractWeekly = weeklyContractMinutes.get(e.id) ?? 1200;
            const baseMax = (isFT && isSecurityEmployee)
                ? FT_SECURITY_WEEKLY_CONTRACT_MINUTES
                : isFT
                    ? 2280
                    : isFPT
                        ? 2280
                        : isPT
                            ? Math.max(1200, ptContractWeekly)
                            : 2400;

            // Window-aware minimum: scale the weekly contract by `weekScale`,
            // CREDIT approved leave against it, then cap at the demand this
            // employee could plausibly absorb (their contract-weighted share
            // + 20% buffer). The cap stops the solver preferring "leave shifts
            // uncovered" over "violate min-contract slack" when the window
            // holds more obligation than work; the leave credit stops it being
            // handed an obligation the leave exclusion has already made
            // impossible to discharge.
            const cappedMin = resolveContractObligationMinutes({
                weeklyContractMinutes: weeklyContractMinutes.get(e.id) ?? 0,
                weekScale,
                leaveDays: (leaveByEmployee.get(e.id) ?? []).length,
                fairShareCapMinutes: fairShareCaps.get(e.id) ?? 0,
            });

            // Classification-resolved rate: Schedule 2 by level (casual vs permanent column);
            // unknown level (0/undefined = "not classified") → conservative
            // defaultRate. Never a hardcoded literal (goes stale at each CPI).
            const levelKey = det?.level && det.level >= 1 && det.level <= 7
                ? (`LEVEL_${det.level}` as keyof typeof windowRateSet.wageRates)
                : null;
            const scheduleRate = levelKey
                ? (isCasual ? windowRateSet.wageRates[levelKey]?.casual : windowRateSet.wageRates[levelKey]?.permanent) ?? null
                : null;
            const hourlyRate = securityRate ?? scheduleRate ?? windowRateSet.defaultRate;
            if (!Number.isFinite(hourlyRate)) {
                throw new Error(
                    `${windowCard?.code ?? 'The rate card'} has no rate for ${e.name}'s classification` +
                    (det?.level ? ` (Level ${det.level})` : '') + '. Add it in Payroll → Pay Rates, then run the AutoScheduler again.',
                );
            }

            return {
                id: e.id,
                name: e.name,
                contract_type: e.contract_type,
                contracted_role_ids: e.contracted_role_ids ?? [],
                is_security_role: isSecurityEmployee,

                hourly_rate: hourlyRate,
                contract_weekly_minutes: isFPT
                    ? fptContractWeekly
                    : isPT
                        ? ptContractWeekly
                        : isCasual
                            ? 0
                            : (e.contracted_weekly_hours || (isFT && isSecurityEmployee ? 42 : 38)) * 60,
                level: det?.level ?? 0,
                // `employeeDetails` never sets is_flexible (fetchEmployeeContractDetails
                // does not select employment_status), so this was permanently false and
                // no one could ever satisfy a `target_requires_flexible` shift. Prefer
                // the value EligibilityService already resolved from the in-scope
                // contract; fall back to the details map for other callers.
                is_flexible: (isCasual || isFT) ? false : (isFptMode ? true : (e.is_flexible ?? det?.is_flexible ?? false)),
                is_student: det?.is_student ?? false,
                visa_limit: (det as any)?.visa_limit ?? 2880,
                // HC-5c compares this against `shift.target_employment_type`, and the
                // DB trigger compares `user_contracts.employment_status` against the
                // same target. They must therefore be derived from the SAME source, or
                // the solver proposes assignments the write will reject. In prod 17 of
                // 122 staff have a `profiles.employment_type` that disagrees with their
                // Active contract (12 look Casual but are Full-Time), so preferring the
                // raw contract status here is what keeps the two in step.
                // `toTargetEmploymentType` is the TS mirror of the solver's
                // `normalize_employment_type()`, so both ends canonicalise identically.
                employment_type: solverEmploymentType(e),
                // Compat/display only — the solver prefers the effective-minute
                // field below. Still anchored to today because that is what the
                // score means (fatigue as of now, Sydney).
                initial_fatigue_score: Math.min(
                  MAX_INITIAL_FATIGUE_SCORE,
                  calculateFatigueWithRecovery(
                    existingRoster.get(e.id) ?? [],
                    formatInTimezone(new Date(), SYDNEY_TZ, 'yyyy-MM-dd')
                  ).current,
                ),
                // The value SC-7 actually uses: same unit, same interval
                // weights, anchored to the HORIZON rather than to today.
                initial_effective_minutes: priorEffectiveMinutesForHorizon(
                  existingRoster.get(e.id) ?? [],
                  dates[0],
                ),
                ...det,
                fairness_debts: debtsMap?.get(e.id) ?? {},
                existing_shifts: existingRoster.get(e.id) ?? [],
                availability_slots: availabilityData.get(e.id)?.slots ?? [],
                has_availability_data: availabilityData.get(e.id)?.hasAnyData ?? false,
                // FT is OPT_OUT unconditionally, because `RosterFetcher` has
                // already decided — using this exact predicate — not to fetch
                // their slots. The two MUST agree: an empty slot list under
                // OPT_IN is a hard filter against every shift.
                //
                // The contract floor is still honoured for everyone else, which
                // is the property the mode protects for PT: if HC-7 charges the
                // solver for failing to give someone hours, missing availability
                // data must not be what makes giving them hours impossible. It
                // uses the WEEKLY basis rather than the window obligation so an
                // employee whose leave happens to span this window does not flip
                // to OPT_IN for it.
                //
                // Why FT no longer rides on that test alone: the floor comes
                // from `employeeDetails.min_contract_minutes ?? baseline(...)`,
                // and `??` passes a recorded ZERO straight through. One FT row
                // with a 0 floor used to flip that person to OPT_IN, and with
                // their slots now deliberately empty there was nothing left to
                // save them — they would be eligible for nothing, silently.
                availability_mode:
                    isFullTimeEmployee(e.employment_status, e.contract_type) ||
                    (weeklyContractMinutes.get(e.id) ?? 0) > 0
                        ? 'OPT_OUT'
                        : 'OPT_IN',
                // HC-5e. What the CONTRACT permits, as against what the employee
                // declared — the only bound on an FT, who carries no slots. Sits
                // after the `...det` spread for the same reason as
                // `unavailable_dates`: a caller-supplied `employeeDetails` must
                // not be able to widen someone's rosterable span.
                ...(envelopes.get(e.id) ?? {}),
                ...(workCycles.get(e.id) ?? {}),
                // WINDOW-SCALED limits — like `unavailable_dates` below, these MUST
                // sit after the `...det` spread. They were previously written above
                // it, so any caller-supplied `employeeDetails` carrying either key
                // overwrote the derived value with a raw WEEKLY number: a 4-week run
                // then sent a 1-week obligation and a 1-week cap, silently dropping
                // both `weekScale` and (now) the approved-leave credit. `det`'s
                // copies are inputs to the derivation, never its output.
                min_contract_minutes: Math.round(cappedMin),
                max_weekly_minutes: Math.round((det?.max_weekly_minutes ?? baseMax) * weekScale),
                // Approved leave (audit F1) — MUST come after the `...det`
                // spread so an employeeDetails copy can never clobber it. The
                // solver's per-day `unavailable_dates` hard filter excludes
                // these dates in both the CP-SAT and greedy/audit paths.
                unavailable_dates: Array.from(new Set([
                    ...((det as { unavailable_dates?: string[] } | undefined)?.unavailable_dates ?? []),
                    ...(leaveByEmployee.get(e.id) ?? []),
                ])),
                // Pending leave as whole-day SOFT windows. Same placement
                // reasoning as `unavailable_dates` — after the `...det` spread,
                // so a caller-supplied copy cannot silently drop them.
                availability_overrides: buildPendingLeaveOverrides(
                    pendingLeaveByEmployee.get(e.id) ?? [],
                    [
                        ...((det as { availability_overrides?: AvailabilityOverrideRef[] } | undefined)
                            ?.availability_overrides ?? []),
                        ...(exceptionsByEmployee.get(e.id) ?? []),
                    ],
                ),
            };
        });

        // ── Multi-engagement staff: what this solve CANNOT see ───────────────
        //
        // `EmployeeInput.employment_type` is ONE scalar per person, and a solve
        // spans sub-departments. HC-5c then hard-filters on
        // `emp.employment_type != shift.target_employment_type`
        // (`ortools_runner.py`), so someone who is Full-Time as an Event Setups
        // Manager and Casual as an Usher — a shape EBA cl 13 (Multi-Hiring)
        // allows and migrations 20260824130000/130100 accept — is silently
        // ineligible for every shift targeting whichever type the scalar did
        // NOT take.
        //
        // This is deliberately a REPORT, not a fix. No scalar can be right, and
        // choosing one would move the error somewhere quieter; the wire needs
        // per-engagement types before the solver can place these people
        // correctly. Meanwhile the failure is an under-assignment — shifts left
        // uncovered with no reason attached to the person who could have taken
        // them — which is precisely the kind that goes unnoticed. So: name them.
        const multiEngagement = scopedEmployees.filter(
            (e) => (e as { has_multiple_engagement_types?: boolean }).has_multiple_engagement_types,
        );
        if (multiEngagement.length > 0) {
            console.warn(
                `[AutoScheduler] ${multiEngagement.length} employee(s) hold more than one employment `
                + `type across their active contracts. The solver carries one employment_type per `
                + `employee, so each is only considered for shifts targeting the type resolved for `
                + `this run — shifts targeting their other type will read as uncovered rather than `
                + `as "nobody eligible". Affected: `
                + multiEngagement.map(e => `${e.name} (${e.employment_status ?? 'unknown'})`).join(', '),
            );
        }

        if (weeklyContractMinutes.size > 0) {
            const obligated = optimizerEmployees.filter(o => (o.min_contract_minutes ?? 0) > 0);
            let capped = 0;
            let leaveCredited = 0;
            for (const e of scopedEmployees) {
                const weekly = weeklyContractMinutes.get(e.id) ?? 0;
                if (weekly <= 0) continue;
                const leaveDays = (leaveByEmployee.get(e.id) ?? []).length;
                if (leaveDays > 0) leaveCredited += 1;
                const afterLeave = Math.max(0, weekly * weekScale - (weekly / 7) * leaveDays);
                if ((fairShareCaps.get(e.id) ?? 0) < afterLeave) capped += 1;
            }
            console.info(
                '[AutoScheduler] HC-7: %d/%d employees carry a contract floor (%dh total over %s week(s)); %d leave-credited, %d cut by the fair-share cap',
                obligated.length,
                scopedEmployees.length,
                Math.round(obligated.reduce((a, o) => a + (o.min_contract_minutes ?? 0), 0) / 60),
                weekScale.toFixed(2),
                leaveCredited,
                capped,
            );
        }

        const validationCtx: ValidationContextMaps = {
            leaveByEmployee,
            workCycles,
            securityRoleIds,
        };

        let optimizerStatus: OptimizerStatus = 'UNKNOWN';
        let solveTimeMs = 0;
        let validationTimeMs = 0;
        let uncoveredV8ShiftIds: string[] = [];
        let validatedProposals: ValidatedProposal[] = [];
        let usedFallback = false;
        let optimizerObjectiveBreakdown: Record<string, number> | null = null;
        // B3/B5 — single-mode transparency, forwarded to the UI.
        let optimizerPillars: PillarScores | null = null;
        let optimizerBinding: BindingConstraint[] | null = null;
        let optimizerAlternatives: ParetoAlternative[] | null = null;
        let optimizerRationaleByShift: Record<string, AssignmentRationale> | undefined;

        // ── Layer 2: Call optimizer (with fallback) ───────────────────────────
        const rawPairs = optimizerShifts.length * optimizerEmployees.length;
        const dynamicBudget = rawPairs > 30_000
            ? 120      // big problems (large monthly rosters): 120s
            : rawPairs > 10_000
                ? 60   // medium: 60s
                : 30;  // small: 30s default
        const solverBudget = input.timeLimitSeconds ?? dynamicBudget;
        if (input.timeLimitSeconds == null && dynamicBudget > 30) {
            console.info(
                '[AutoScheduler] [run=%s] Auto-scaled solver budget to %ds for %d raw pairs',
                runId, dynamicBudget, rawPairs,
            );
        }

        try {
            const optimizeReq: OptimizeRequest = {
                shifts: optimizerShifts,
                employees: optimizerEmployees,
                constraints: buildSolverConstraints(input.constraints, optimizerShifts, solverMode, windowCard),
                // B1 — single-mode: always send the pinned policy (no sliders).
                strategy: SINGLE_MODE_STRATEGY,
                solver_params: {
                    max_time_seconds: solverBudget,
                    num_workers: input.numWorkers ?? 8,
                    compute_alternatives: input.computeAlternatives ?? false,
                    decompose_by_week: rawPairs > 30_000,
                },
            };

            const optimizeResponse = await optimizerClient.optimize(optimizeReq, input.signal);
            throwIfAborted();
            optimizerStatus = optimizeResponse.status;
            solveTimeMs = optimizeResponse.solve_time_ms;
            optimizerObjectiveBreakdown = optimizeResponse.objective_breakdown ?? null;
            // B3/B5/B4 — capture single-mode transparency for the UI.
            optimizerPillars = optimizeResponse.pillars ?? null;
            optimizerBinding = optimizeResponse.binding_constraints ?? null;
            optimizerAlternatives = optimizeResponse.alternatives ?? null;
            optimizerRationaleByShift = Object.fromEntries(
                optimizeResponse.assignments
                    .filter(a => a.rationale)
                    .map(a => [a.shift_id, a.rationale as AssignmentRationale]),
            );

            if (optimizerStatus === 'INFEASIBLE' || optimizerStatus === 'UNKNOWN' || optimizerStatus === 'MODEL_INVALID') {
                // Optimizer cannot find a solution → fall back to greedy
                console.warn('[AutoScheduler] Optimizer returned %s — falling back to greedy engine', optimizerStatus);
                usedFallback = true;
                const validationStart = performance.now();
                validatedProposals = await greedyFallback(
                    futureShifts,
                    scopedEmployees,
                    employeeDetails,
                    existingRoster,
                    input.strategy,
                    windowObligationMinutes,
                    debtsMap,
                    validationCtx,
                    activeMode,
                    windowCard,
                );
                validatedProposals.push(...excludedProposals);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                // ── Parse + compliance validate ───────────────────────────────
                const { shiftMap, employeeMap } = solutionParser.buildMaps(scopedShifts, scopedEmployees);
                const { groups, uncoveredV8ShiftIds: uncov } = solutionParser.parse(optimizeResponse, shiftMap, employeeMap);
                
                // Add back the past shifts as uncovered (optimizer never saw them)
                uncoveredV8ShiftIds = [...uncov, ...excludedShiftIds];

                const validationStart = performance.now();
                validatedProposals = await this._validateProposals(
                    groups,
                    employeeDetails,
                    existingRoster,
                    employeeMap,
                    validationCtx,
                    v8SolverConfig,
                );

                // Add back the past shifts as explicitly failed proposals (for UI visibility)
                validatedProposals.push(...excludedProposals);

                validationTimeMs = Math.round(performance.now() - validationStart);
                console.debug('[AutoScheduler] Compliance validation: %dms', validationTimeMs);
            }
        } catch (err) {
            if (err instanceof OptimizerError &&
                (err.code === 'CONNECTION_REFUSED' || err.code === 'SOLVER_ERROR')) {
                console.warn(
                    '[AutoScheduler] Optimizer %s — falling back to greedy engine',
                    err.code === 'CONNECTION_REFUSED' ? 'offline' : 'budget exceeded',
                );
                usedFallback = true;
                optimizerStatus = 'UNKNOWN';
                const validationStart = performance.now();
                validatedProposals = await greedyFallback(
                    futureShifts,
                    scopedEmployees,
                    employeeDetails,
                    existingRoster,
                    input.strategy,
                    windowObligationMinutes,
                    debtsMap,
                    validationCtx,
                    activeMode,
                    windowCard,
                );
                validatedProposals.push(...excludedProposals);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                throw err;
            }
        }
        throwIfAborted();

        // ── Layer 2.4: Compliance repair — re-home rejected assignments ───────
        if (!usedFallback && validatedProposals.some(p => !p.passing)) {
            throwIfAborted();
            const repairStart = performance.now();
            const before = validatedProposals.filter(p => !p.passing).length;
            validatedProposals = await this._repairCompliance({
                proposals: validatedProposals,
                optimizerShifts,
                optimizerEmployees,
                inputShifts: scopedShifts,
                inputEmployees: scopedEmployees,
                employeeDetails,
                existingRoster,
                validationCtx,
                constraints: buildSolverConstraints(input.constraints, optimizerShifts, solverMode, windowCard),
                budgetSeconds: Math.min(30, Math.max(10, Math.round(solverBudget / 4))),
                signal: input.signal,
                solverConfig: v8SolverConfig,
            });
            const after = validatedProposals.filter(p => !p.passing).length;
            console.info(
                '[AutoScheduler] Compliance repair: re-homed %d of %d rejected shift(s) in %dms (%d left uncovered for compliance)',
                before - after, before, Math.round(performance.now() - repairStart), after,
            );
        }

        // ── Layer 2.5: Enrich with Health Metrics (Fatigue/Fairness/Cost) ────
        if (validatedProposals.length > 0) {
            const employeeMap = new Map(scopedEmployees.map(e => [e.id, e]));
            const fallbackPriorOrdinaryMap = usedFallback
                ? buildGreedyFallbackPriorOrdinaryMap(validatedProposals, existingRoster, scopedShifts)
                : new Map<string, number>();

            for (const p of validatedProposals) {
                if (!p.employeeId) continue;
                const emp = employeeMap.get(p.employeeId);
                const shift = scopedShifts.find(s => s.id === p.shiftId);

                if (usedFallback && shift && emp) {
                    p.optimizerCost = estimateGreedyFallbackCost(
                        shift, emp, employeeDetails.get(emp.id), fallbackPriorOrdinaryMap.get(p.shiftId), rateCards,
                    );
                }

                // 2. Calculate Fatigue
                const empShifts = existingRoster.get(p.employeeId) ?? [];
                const proposedForEmp = validatedProposals.filter(pr => pr.employeeId === p.employeeId && pr.passing);
                
                const totalShifts = [
                    ...empShifts,
                    ...proposedForEmp.map(pr => ({
                        id: pr.shiftId,
                        shift_date: pr.shiftDate,
                        start_time: pr.startTime,
                        end_time: pr.endTime,
                        duration_minutes: durationMinutes(pr.startTime, pr.endTime),
                        unpaid_break_minutes: scopedShifts.find(s => s.id === pr.shiftId)?.unpaid_break_minutes ?? 0
                    })),
                ];

                p.fatigueScore = calculateFatigueWithRecovery(
                    totalShifts as any,
                    p.shiftDate,
                ).current;

                // 3. Calculate Utilization (Contract Obligation in FT_STANDARD / FT_SECURITY / PT)
                if (isFtStandard) {
                    const netInWindow = totalShifts
                        .filter(s => (s.shift_date ?? '') >= dates[0])
                        .reduce(
                            (acc, s) => acc + Math.max(0, ((s as any).duration_minutes || 0) - ((s as any).unpaid_break_minutes || 0)),
                            0,
                        );
                    const ftTarget = windowObligationMinutes.get(p.employeeId) || (2280 * weekScale);
                    p.utilization = calculateUtilization(netInWindow / 60, ftTarget / 60);
                } else if (isFtSecurity) {
                    // Sch 3 §3.2(a): FT Security meal break is paid -> full clock duration counts
                    const paidInWindow = totalShifts
                        .filter(s => (s.shift_date ?? '') >= dates[0])
                        .reduce((acc, s) => acc + ((s as any).duration_minutes || 0), 0);
                    const secTarget = windowObligationMinutes.get(p.employeeId) || (FT_SECURITY_WEEKLY_CONTRACT_MINUTES * weekScale);
                    p.utilization = calculateUtilization(paidInWindow / 60, secTarget / 60);
                } else if (isPtMode) {
                    const empIsSec = emp ? resolveIsSecurity(emp) : false;
                    const workedInWindow = totalShifts
                        .filter(s => (s.shift_date ?? '') >= dates[0])
                        .reduce(
                            (acc, s) => acc + (empIsSec
                                ? ((s as any).duration_minutes || 0)
                                : Math.max(0, ((s as any).duration_minutes || 0) - ((s as any).unpaid_break_minutes || 0))),
                            0,
                        );
                    const ptTarget = windowObligationMinutes.get(p.employeeId)
                        || ((weeklyContractMinutes.get(p.employeeId) || 1200) * weekScale);
                    p.utilization = calculateUtilization(workedInWindow / 60, ptTarget / 60);
                } else if (isFptMode) {
                    const empIsSec = emp ? resolveIsSecurity(emp) : false;
                    const workedInWindow = totalShifts
                        .filter(s => (s.shift_date ?? '') >= dates[0])
                        .reduce(
                            (acc, s) => acc + (empIsSec
                                ? ((s as any).duration_minutes || 0)
                                : Math.max(0, ((s as any).duration_minutes || 0) - ((s as any).unpaid_break_minutes || 0))),
                            0,
                        );
                    const fptTarget = windowObligationMinutes.get(p.employeeId)
                        || ((weeklyContractMinutes.get(p.employeeId) || FPT_WEEKLY_CONTRACT_MINUTES) * weekScale);
                    p.utilization = calculateUtilization(workedInWindow / 60, fptTarget / 60);
                } else {
                    const scheduledMins = totalShifts.reduce((acc, s) => acc + (s as any).duration_minutes || 0, 0);
                    const contractedMins = (emp?.max_weekly_minutes ?? 2400) * weekScale;
                    p.utilization = calculateUtilization(scheduledMins / 60, contractedMins / 60);
                }
            }
        }

        // ── Compliance is a HARD gate ─────────────────────────────────────────
        const compliantProposals = validatedProposals.filter(p => p.passing);
        const droppedForCompliance = validatedProposals.filter(p => !p.passing);
        uncoveredV8ShiftIds = Array.from(
            new Set([...uncoveredV8ShiftIds, ...droppedForCompliance.map(p => p.shiftId)]),
        );

        const passing = compliantProposals.length;
        const failing = 0; // by construction — nothing non-compliant reaches the roster

        let pillars = optimizerPillars;
        if (pillars) {
            const total = pillars.coverage?.total ?? (passing + uncoveredV8ShiftIds.length);
            const compliantCost = compliantProposals.reduce((s, p) => s + (p.optimizerCost || 0), 0);
            pillars = {
                ...pillars,
                coverage: {
                    ...pillars.coverage,
                    score: total > 0 ? Math.round((passing / total) * 1000) / 10 : 100,
                    covered: passing,
                    total,
                },
                cost: {
                    ...pillars.cost,
                    total: Math.round(compliantCost * 100) / 100,
                    avg_per_shift: passing > 0 ? Math.round((compliantCost / passing) * 100) / 100 : 0,
                },
            };
        }

        const complianceBinding = droppedForCompliance
            .filter(p => p.violations?.length)
            .map(p => ({
                shift_id: p.shiftId,
                eligible_count: 0,
                reason: (p.violations.find(v => v.blocking) ?? p.violations[0])?.description
                    ?? 'Left uncovered to keep the roster 100% compliant',
            }));

        const result: AutoSchedulerResult = {
            mode: activeMode,
            optimizerStatus,
            solveTimeMs,
            validationTimeMs,
            totalProposals: passing,        // compliant-only → compliance pillar reads 100%
            passing,
            failing,
            uncoveredV8ShiftIds,
            proposals: compliantProposals,  // only assignments we will actually book
            shiftVersions: Object.fromEntries(
                scopedShifts
                    .filter(s => typeof s.version === 'number')
                    .map(s => [s.id, s.version as number]),
            ),
            canCommit: passing > 0,
            usedFallback,
            capacityCheck,
            objective_breakdown: optimizerObjectiveBreakdown,
            fairnessLedger: ledgerStatus,
            pillars,
            bindingConstraints: [...(optimizerBinding ?? []), ...complianceBinding],
            alternatives: optimizerAlternatives,
            rationaleByShift: optimizerRationaleByShift,
        };



        // ── Layer 3: Audit uncovered shifts (the "Why") ───────────────────────
        if (result.uncoveredV8ShiftIds.length > 0 || result.failing > 0) {
            throwIfAborted();
            const auditStart = performance.now();
            
            const shiftsToAudit = [
                ...result.uncoveredV8ShiftIds,
                ...result.proposals.filter(p => !p.passing).map(p => p.shiftId)
            ];
            const uniqueAuditIds = Array.from(new Set(shiftsToAudit));

            result.uncoveredAudit = await auditor.audit({
                targetShiftIds: uniqueAuditIds,
                allShifts: scopedShifts,
                allEmployees: scopedEmployees,
                proposals: result.proposals,
                optimizerShifts,
                optimizerEmployees,
                constraints: buildSolverConstraints(input.constraints, optimizerShifts, solverMode, windowCard),
                capacityCheck,
                availabilityData,
            });
            result.auditedUncoveredCount = result.uncoveredAudit.length;
            console.debug('[AutoScheduler] Audit complete: %dms', Math.round(performance.now() - auditStart));
        }

        console.info('[AutoScheduler] Preview ready:', {
            run_id: runId,
            status: optimizerStatus, passing, failing,
            uncovered: uncoveredV8ShiftIds.length, fallback: usedFallback,
            totalMs: Math.round(performance.now() - t0),
        });

        return result;
    }

    /**
     * Commit the preview's compliant proposals — atomic multi-pair path.
     *
     * Flow:
     *   1. Group the compliant proposals by employee.
     *   2. Send the whole list to sm_bulk_assign_atomic via ONE RPC call with
     *      the shift versions the preview validated. Atomic across all
     *      employees: a hard DB error writes nothing. Any shift claimed,
     *      edited or published since preview is refused and returned as a
     *      conflict; one already assigned to the intended employee counts as
     *      booked, so a retried Apply is safe.
     *   3. Map the RPC's per_employee breakdown back to CommitResult shape.
     *
     * NOTE: there is deliberately NO per-employee compliance re-simulation. The
     * preview validates with the optimizer's injected context (fresh data fetched
     * right before the solve) and the compliance hard gate guarantees the
     * proposals are 100% compliant; re-validating here via scenarioLoader's
     * DB-fetch path used a DIFFERENT data context and disagreed with the preview,
     * silently dropping ~23% of valid assignments. preview == commit now.
     */
    async commit(result: AutoSchedulerResult): Promise<CommitResult> {
        const byEmployee = new Map<string, string[]>();
        for (const p of result.proposals) {
            if (!p.passing || !p.employeeId) continue;
            const list = byEmployee.get(p.employeeId) ?? [];
            list.push(p.shiftId);
            byEmployee.set(p.employeeId, list);
        }

        if (byEmployee.size === 0) {
            return { success: true, totalCommitted: 0, failedEmployees: [], concurrencyConflicts: [] };
        }

        // ── Book directly via the atomic RPC (preview == commit) ──────────────
        // No per-employee compliance re-simulation here. The preview already
        // validated every proposal against fresh data fetched right before the
        // solve, and the compliance HARD GATE guarantees result.proposals are
        // 100% compliant. The old recheck called scenarioLoader WITHOUT
        // injectedData, so it re-fetched a DIFFERENT data context from the DB
        // than the preview injected (V8 employee context + existing-roster
        // window). That made it disagree with the preview and silently drop ~23%
        // of valid assignments. Apply-time drift — a shift claimed by someone
        // else, edited, or published since preview — is refused atomically by
        // sm_bulk_assign_atomic against the versions the preview validated, and
        // returned as conflicts. So what the preview approves is exactly what
        // books, or nothing does.
        const entries = Array.from(byEmployee.entries());
        const atomicAssignments = entries.map(([employeeId, shiftIds]) => ({ employeeId, shiftIds }));

        const atomicResult = await assignmentCommitter.commitAtomic(atomicAssignments, result.shiftVersions);

        // Failures/conflicts come solely from the atomic RPC: a shift changed or
        // claimed since preview (→ conflict), or a hard DB error (→ failedEmployees).
        const allFailedEmployees = atomicResult.failedEmployees;
        const allConflicts = atomicResult.concurrencyConflicts;

        console.debug('[AutoScheduler] Atomic commit complete:', {
            totalCommitted: atomicResult.totalCommitted,
            failedEmployees: allFailedEmployees,
            concurrencyConflicts: allConflicts,
        });

        const success = atomicResult.success
            && allFailedEmployees.length === 0
            && allConflicts.length === 0;

        return {
            success,
            totalCommitted: atomicResult.totalCommitted,
            failedEmployees: allFailedEmployees,
            concurrencyConflicts: allConflicts,
            message: success ? undefined : atomicResult.message,
        };
    }

    async checkHealth(): Promise<OptimizerHealth> {
        return optimizerClient.healthCheck();
    }



    /**
     * Demand-vs-supply pre-check. Compares total shift-minutes per day
     * against available employee-minutes per day. Pure arithmetic, no
     * solver involvement. Surfaces days that are mathematically impossible
     * to fully cover before we waste cycles asking the optimizer.
     */
    capacityCheck(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
        employeeDetails?: Map<string, Partial<OptimizerEmployee>>,
    ): CapacityCheck {
        return this._capacityCheck(shifts, employees, employeeDetails);
    }

    private _capacityCheck(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
        employeeDetails?: Map<string, Partial<OptimizerEmployee>>,
    ): CapacityCheck {
        // Per-employee daily cap (default 8h). Today employees don't carry
        // a max_daily_minutes field on the public type, but the optimizer
        // overrides do — fall back to default for the rest.
        const secRoleIds = deriveSecurityRoleIds(shifts);
        const dailyCapFor = (emp: EmployeeMeta): number => {
            const det = employeeDetails?.get(emp.id) as Partial<OptimizerEmployee> | undefined;
            const weekly = det?.max_weekly_minutes;
            // Approximate daily cap as weekly / 5 if provided (matches typical
            // 5-day work weeks); else 12h (720m) for Sch 3 Security (whose
            // standard shift is 12h, §3.1(a)) or 10h (600m) general default.
            if (weekly && weekly > 0) return Math.round(weekly / 5);
            const isSec = det?.is_security_role
                ?? (emp.contracted_role_ids ?? []).some(id => secRoleIds.has(id));
            if (isSec) return FT_MAX_DAILY_NET_MINUTES;
            return DEFAULT_MAX_DAILY_MINUTES;
        };

        // aggregate demand by day
        const demandByDate = new Map<string, { minutes: number; count: number; pastMinutes: number }>();
        const now = Date.now();
        
        for (const s of shifts) {
            const mins = durationMinutes(s.start_time, s.end_time);
            const cur = demandByDate.get(s.shift_date) ?? { minutes: 0, count: 0, pastMinutes: 0 };
            cur.minutes += mins;
            cur.count += 1;
            
            // Identify if this shift is already started (Sydney wall-clock).
            const start = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
            if (start.getTime() <= now) {
                cur.pastMinutes += mins;
            }
            
            demandByDate.set(s.shift_date, cur);
        }

        // Supply per day = sum of all employees' daily caps. Employees can
        // theoretically work any day, so this is an upper bound on supply
        // (real availability windows would only reduce it further).
        const supplyPerDay = employees.reduce((acc, e) => acc + dailyCapFor(e), 0);

        const perDay: CapacityDayBreakdown[] = [];
        let totalDemand = 0;
        let totalSupply = 0;

        for (const [date, demand] of demandByDate) {
            // For capacity calculation, past shifts should subtract from supply OR add to deficit.
            // Here we treat them as "unfillable demand" that reduces effective supply.
            const availableSupply = demand.pastMinutes > 0 ? Math.max(0, supplyPerDay - demand.pastMinutes) : supplyPerDay;
            
            const deficit = Math.max(0, demand.minutes - availableSupply);
            const day: CapacityDayBreakdown = {
                date,
                shiftCount: demand.count,
                demandMinutes: demand.minutes,
                supplyMinutes: supplyPerDay,
                employeeCount: employees.length,
                deficitMinutes: deficit,
                sufficient: deficit === 0,
            };
            perDay.push(day);
            totalDemand += demand.minutes;
            totalSupply += supplyPerDay;
        }

        perDay.sort((a, b) => a.date.localeCompare(b.date));
        const deficitDays = perDay.filter(d => !d.sufficient);

        return {
            sufficient: deficitDays.length === 0,
            totalDemandMinutes: totalDemand,
            totalSupplyMinutes: totalSupply,
            deficitDays,
            perDay,
        };
    }

    /**
     * Compliance repair loop — maximise COMPLIANT coverage.
     *
     * The optimizer assigns the best (cheapest/fairest) eligible employee per
     * shift, but the TS compliance engine may reject some of those assignments
     * (rules the solver doesn't model). Rather than just dropping them, we
     * re-solve the rejected shifts onto a DIFFERENT employee:
     *
     *   1. Keep the compliant assignments; collect the rejected ones.
     *   2. Re-solve ONLY the rejected shifts, with: the kept roster pinned as
     *      existing_shifts (cross-assignment rest/hours preserved) and every
     *      known-bad (employee, shift) pair excluded (so the solver must pick a
     *      different employee, or leave the shift uncovered).
     *   3. Validate the new assignments; fold the passers into the roster, add
     *      any new failures to the exclusion set, and repeat.
     *
     * Converges because the exclusion set grows monotonically and each shift has
     * finitely many eligible employees; bounded by MAX_ITERS for safety. The
     * re-solves are tiny (only the rejected shifts) so the added time is small.
     * Best-effort: any re-solve error keeps the current roster.
     */
    private async _repairCompliance(args: {
        proposals: ValidatedProposal[];
        optimizerShifts: OptimizerShift[];
        optimizerEmployees: OptimizerEmployee[];
        inputShifts: ShiftMeta[];
        inputEmployees: EmployeeMeta[];
        employeeDetails: Map<string, Partial<OptimizerEmployee>>;
        existingRoster: Map<string, ExistingShiftRef[]>;
        validationCtx?: ValidationContextMaps;
        constraints: OptimizerConstraints;
        budgetSeconds: number;
        signal?: AbortSignal;
        solverConfig?: SolverConfig;
    }): Promise<ValidatedProposal[]> {
        const {
            proposals, optimizerShifts, optimizerEmployees, inputShifts, inputEmployees,
            employeeDetails, existingRoster, validationCtx, constraints, budgetSeconds, signal, solverConfig,
        } = args;
        const MAX_ITERS = 3;
        const SEP = '\x00';
        const shiftById = new Map(optimizerShifts.map(s => [s.id, s]));
        const { shiftMap, employeeMap } = solutionParser.buildMaps(inputShifts, inputEmployees);

        // Only retry genuine compliance failures with a known assignee — never a
        // PAST_SHIFT (unfixable) or a SYSTEM error, and never
        // an empty employee.
        const isRepairable = (p: ValidatedProposal) =>
            !!p.employeeId && !(p.violations ?? []).some(v => v.type === 'PAST_SHIFT' || v.type === 'SYSTEM');

        let compliant = proposals.filter(p => p.passing);
        const failing = proposals.filter(p => !p.passing);
        const nonRepairable = failing.filter(p => !isRepairable(p));
        const pending = failing.filter(isRepairable);
        if (pending.length === 0) return proposals;

        const excluded = new Set<string>();
        const unresolved = new Map<string, ValidatedProposal>();
        const gaveUp: ValidatedProposal[] = [];
        for (const p of pending) {
            excluded.add(`${p.employeeId}${SEP}${p.shiftId}`);
            unresolved.set(p.shiftId, p);
        }

        for (let iter = 0; iter < MAX_ITERS && unresolved.size > 0; iter++) {
            if (signal?.aborted) break;

            // Pin the kept compliant roster as existing_shifts (for BOTH the
            // solver and the validator) so the repair respects rest/hours/overlap
            // against assignments we are keeping.
            const pinsByEmp = new Map<string, ExistingShiftRef[]>();
            for (const p of compliant) {
                const s = shiftById.get(p.shiftId);
                if (!s || !p.employeeId) continue;
                const arr = pinsByEmp.get(p.employeeId) ?? [];
                arr.push({
                    id: s.id, shift_date: s.shift_date, start_time: s.start_time,
                    end_time: s.end_time, duration_minutes: s.duration_minutes,
                    unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
                    paid_break_minutes: s.paid_break_minutes ?? 0,
                });
                pinsByEmp.set(p.employeeId, arr);
            }
            const repairEmployees: OptimizerEmployee[] = optimizerEmployees.map(e => ({
                ...e,
                existing_shifts: [...(e.existing_shifts ?? []), ...(pinsByEmp.get(e.id) ?? [])],
            }));
            const repairShifts = optimizerShifts.filter(s => unresolved.has(s.id));

            let repairResp: OptimizeResponse;
            try {
                repairResp = await optimizerClient.optimize({
                    shifts: repairShifts,
                    employees: repairEmployees,
                    constraints,
                    strategy: SINGLE_MODE_STRATEGY,
                    solver_params: { max_time_seconds: budgetSeconds, num_workers: 8 },
                    excluded_pairs: Array.from(excluded).map(k => {
                        const [employee_id, shift_id] = k.split(SEP);
                        return { employee_id, shift_id };
                    }),
                }, signal);
            } catch (err) {
                console.warn('[AutoScheduler] Compliance repair re-solve failed; keeping current roster', err);
                break;
            }

            const { groups } = solutionParser.parse(repairResp, shiftMap, employeeMap);

            // Validator must also see the pinned roster (rest/hours) → augment.
            const augmentedRoster = new Map(existingRoster);
            for (const [empId, pins] of pinsByEmp) {
                augmentedRoster.set(empId, [...(existingRoster.get(empId) ?? []), ...pins]);
            }
            const repairValidated = await this._validateProposals(
                groups,
                employeeDetails,
                augmentedRoster,
                employeeMap,
                validationCtx,
                solverConfig,
            );

            const placed = new Set(repairValidated.map(p => p.shiftId));
            const newlyPassing = repairValidated.filter(p => p.passing);
            const newlyFailing = repairValidated.filter(p => !p.passing);

            compliant = [...compliant, ...newlyPassing];
            for (const p of newlyPassing) unresolved.delete(p.shiftId);
            for (const p of newlyFailing) {
                excluded.add(`${p.employeeId}${SEP}${p.shiftId}`);
                if (unresolved.has(p.shiftId)) unresolved.set(p.shiftId, p); // latest failing attempt
            }
            // A pending shift the solver couldn't place at all this round has no
            // remaining compliant candidate → stop retrying it, and preserve its
            // failing proposal in `gaveUp` so the hard gate marks it uncovered.
            for (const sid of Array.from(unresolved.keys())) {
                if (!placed.has(sid)) {
                    gaveUp.push(unresolved.get(sid)!);
                    unresolved.delete(sid);
                }
            }
            if (newlyFailing.length === 0) break; // nothing new failed → converged
        }

        // Kept compliant + whatever still couldn't be re-homed (stays failing →
        // uncovered by the hard gate) + the unfixable failures.
        return [...compliant, ...gaveUp, ...Array.from(unresolved.values()), ...nonRepairable];
    }

    private async _validateProposals(
        groups: ReturnType<typeof solutionParser.parse>['groups'],
        employeeDetails: Map<string, Partial<OptimizerEmployee>>,
        existingRoster: Map<string, ExistingShiftRef[]>,
        employeeMap?: Map<string, EmployeeMeta>,
        validationCtx?: ValidationContextMaps,
        solverConfig?: SolverConfig,
    ): Promise<ValidatedProposal[]> {
        const all: ValidatedProposal[] = [];

        // Aggregate compliance-failure diagnostics into ONE summary log at the
        // end, instead of one noisy console line per employee (100+ staff floods
        // the console and reads like an error storm).
        let failTotal = 0;
        const failedStaff = new Set<string>();
        const failByRule: Record<string, number> = {};

        for (const group of groups) {
            let validationResult: ValidationRunResult;
            try {
                const details = employeeDetails.get(group.employeeId);
                const existing = existingRoster.get(group.employeeId) ?? [];
                const emp = employeeMap?.get(group.employeeId);

                validationResult = await assignmentValidator.simulate(
                    group.shiftIds, 
                    group.employeeId, 
                    { 
                        mode: 'PARTIAL_APPLY',
                        solverConfig,
                        injectedData: {
                            candidateShifts: group.proposals.map(p => ({
                                id: p.shiftId,
                                shift_date: p.shiftDate,
                                start_time: p.startTime,
                                end_time: p.endTime,
                                assigned_employee_id: null,
                                role_id: p.roleId,
                                lifecycle_status: 'draft',
                                unpaid_break_minutes: p.unpaidBreakMinutes ?? 0,
                                paid_break_minutes: p.paidBreakMinutes ?? 0,
                                target_employment_type: p.targetEmploymentType ?? null,
                                target_requires_flexible: p.targetRequiresFlexible ?? false,
                            })) as any,
                            existingShifts: existing.map(e => ({
                                id: e.id,
                                shift_date: e.shift_date,
                                start_time: e.start_time,
                                end_time: e.end_time,
                                assigned_employee_id: group.employeeId,
                                unpaid_break_minutes: e.unpaid_break_minutes ?? 0,
                                paid_break_minutes: e.paid_break_minutes ?? 0,
                            })) as any,
                            employee: buildInjectedEmployeeInfo({
                                employeeId: group.employeeId,
                                employeeName: group.employeeName,
                                emp,
                                details,
                                ctx: validationCtx,
                            }),
                        }
                    },
                );
            } catch (err) {
                for (const p of group.proposals) {
                    all.push({
                        shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                        shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                        optimizerCost: p.cost, employmentType: p.employmentType, complianceStatus: 'FAIL',
                        roleName: p.roleName,
                        violations: [{
                            type: 'SYSTEM', ruleName: 'Compliance Check Failed',
                            description: 'Compliance check error', blocking: true,
                        }],
                        passing: false,
                    });
                }
                continue;
            }

            const resultByShift = new Map(validationResult.results.map(r => [r.shiftId, r]));

            // Diagnostic: accumulate WHICH rule disagrees with the solver, so the
            // single end-of-pass summary can report it. (The optimizer can return
            // 100% coverage while the validator rejects some proposals; those are
            // then left uncovered to keep the roster compliant.)
            const groupFail = validationResult.results.filter(r => !r.passing).length;
            if (groupFail > 0) {
                failTotal += groupFail;
                failedStaff.add(group.employeeName);
                for (const r of validationResult.results) {
                    for (const v of r.violations ?? []) {
                        failByRule[v.violation_type] = (failByRule[v.violation_type] ?? 0) + 1;
                    }
                }
            }

            for (const p of group.proposals) {
                const cr = resultByShift.get(p.shiftId);
                all.push({
                    shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                    shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                    optimizerCost: p.cost,
                    employmentType: p.employmentType,
                    roleName: p.roleName,
                    complianceStatus: cr?.status === 'PASS' ? 'PASS' : cr?.status === 'WARN' ? 'WARN' : 'FAIL',
                    violations: (cr?.violations ?? []).map(v => ({
                        type: v.violation_type, ruleName: v.rule_name,
                        description: v.description, blocking: v.blocking,
                    })),
                    passing: cr?.passing ?? false,
                });
            }
        }

        if (failTotal > 0) {
            console.warn(
                '[AutoScheduler] Validation: %d assignment(s) across %d staff failed compliance and will be left uncovered — by rule: %o',
                failTotal, failedStaff.size, failByRule,
            );
        }

        return all;
    }

}

export const autoSchedulerController = new AutoSchedulerController();
