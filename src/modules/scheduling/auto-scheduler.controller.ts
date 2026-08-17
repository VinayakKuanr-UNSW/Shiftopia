/**
 * AutoSchedulerController — Two-Layer Pipeline Orchestration (v2)
 *
 * Layer 1 — Optimization (OR-Tools CP-SAT):
 *   Sends unassigned shifts + employees to the Python service.
 *   Receives proposed assignment map (proposals only, never writes DB).
 *
 * Layer 2 — Compliance Validation:
 *   BulkAssignmentController.simulate() validates each proposal against the
 *   employee's real schedule (incremental feasibility check).
 *
 * Concurrency Recheck (Critical):
 *   Before final DB commit, simulate() is re-run with fresh DB state to
 *   catch any assignments made by other users since the preview was shown.
 *
 * Fallback Strategy:
 *   INFEASIBLE / UNKNOWN / CONNECTION_REFUSED → falls back to the incremental
 *   bulk assignment engine (greedy first-fit over unfilled shifts).
 *
 * Usage:
 *   const preview = await autoSchedulerController.run(shifts, employees);
 *   // Manager reviews preview in AutoSchedulerPanel
 *   const result  = await autoSchedulerController.commit(preview);
 */

import { parseISO, startOfISOWeek } from 'date-fns';
import { optimizerClient, OptimizerError } from './optimizer/optimizer.client';
import { solutionParser } from './optimizer/solution-parser';
import { bulkAssignmentController, type BulkAssignmentResult } from '@/modules/rosters/bulk-assignment';
import { assignmentCommitter } from '@/modules/rosters/bulk-assignment/engine/assignment-committer';
import { parseZonedDateTime, formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { extractLevel } from '../rosters/domain/projections/utils/cost';
import { estimateDetailedShiftCost as estimateDetailedShiftCostObj } from '../rosters/domain/projections/utils/cost/index';
import { resolveRateSet, type RateSet } from '../rosters/domain/projections/utils/cost/rate-schedule';
import { calculateFatigueWithRecovery, effectiveMinutes, FATIGUE_BANDS } from '../rosters/domain/projections/utils/fatigue';
import { calculateUtilization } from '../rosters/domain/projections/utils/fairness';
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import { isFullTimeEmployee, toTargetEmploymentType } from '@/modules/core/model/employment.types';
import type { AvailabilityOverrideRef, ExistingShiftRef } from './types';
import { auditor } from './audit/auditor';
import { rosterFetcher, durationMinutes } from './data/roster-fetcher';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import {
    debtsToMap,
    classifyShift,
    strategyMult,
    shiftFairnessPenaltyCents,
    debtToObjectiveCoeff,
    type ShiftForFairness,
} from '@/modules/rosters/domain/fairness-ledger';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { EMERGENT_WINDOW_MS } from '@/modules/rosters/domain/bidding-urgency';
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
    UncoveredAudit,
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
            .filter(s => s.roleName?.toLowerCase().includes('security'))
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
export function baselineWeeklyContractMinutes(contractType: string | null | undefined): number {
    const raw = contractType || '';
    if (raw === 'FT' || /full/i.test(raw)) return 2280;  // 38h
    if (raw === 'PT' || /part/i.test(raw)) return 1200;  // 20h
    return 0;                                            // casual — HC-7 exempt
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

export interface ContractObligationInput {
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
export interface GreedyUtilizationTerms {
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
    isExisting: boolean;
}

/**
 * Builds `proposalShiftId -> priorOrdinaryHoursThisWeek` for the greedy
 * fallback's re-estimate, from the union of each employee's existing
 * committed roster and this run's newly PASSING, non-casual proposals
 * (casual weekly OT is ambiguous under the EA — see cost/standard.ts).
 * Existing shifts seed the running total; only proposal shift IDs are
 * ever present in the returned map.
 */
export function buildGreedyFallbackPriorOrdinaryMap(
    proposals: ValidatedProposal[],
    existingRoster: Map<string, ExistingShiftRef[]>,
): Map<string, number> {
    const prior = new Map<string, number>();
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
                key: s.id, shiftDate: s.shift_date, startTime: s.start_time, endTime: s.end_time, isExisting: true,
            });
        }
    }
    for (const p of proposals) {
        if (!p.passing || !p.employeeId) continue;
        if (/casual/i.test(p.employmentType || '')) continue;
        pushEntry(p.employeeId, {
            key: p.shiftId, shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime, isExisting: false,
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
                const net = durationMinutes(entry.startTime, entry.endTime) / 60;
                const dailyOt = Math.max(0, net - 12);
                running += Math.max(0, net - dailyOt);
            }
        }
    }

    return prior;
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
export const MAX_OPTIMIZER_SHIFTS = 2000;
export const MAX_OPTIMIZER_EMPLOYEES = 500;

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
    employeeDetails?: Map<string, Partial<OptimizerEmployee>>;
    constraints?: OptimizerConstraints;
    strategy?: OptimizerStrategy;
    timeLimitSeconds?: number;
    numWorkers?: number;
    /** Allows the caller to abort an in-flight run before it overwrites state. */
    signal?: AbortSignal;
    /**
     * Org scope for the F1 fairness ledger. When provided, the optimizer reads
     * each employee's cumulative fairness debts and biases the roster toward
     * whoever is "owed" undesirable shifts, then writes the committed shifts
     * back to the ledger. When ABSENT, the ledger is cleanly skipped (no debts,
     * no write-back) — the feature is purely additive.
     */
    organizationId?: string;
    /** B4 — when true, the solver also returns Pareto "what-if" alternatives
     *  (cheapest / most-balanced) for the trade-off explorer. Adds solve time,
     *  so the UI requests it explicitly. */
    computeAlternatives?: boolean;
}

export interface CommitResult {
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
): Promise<ValidatedProposal[]> {
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
        // Shared classifier (audit F-11). This block used to roll its own:
        //   `new Date(shift.shift_date).getDay()`  — parses as UTC midnight and
        //       reads back in LOCAL time, so a Saturday shift classified as
        //       Friday for any viewer west of UTC; and
        //   `startH < 6 || endH <= startH`         — treated every shift merely
        //       ENDING at midnight (18:00–00:00, a very common close) as night
        //       work, which neither the ledger nor the solver does.
        // A fallback run therefore scored these shifts differently from the
        // solver — and the fallback fires exactly when the optimizer is
        // unhealthy, i.e. when nobody is watching.
        const shiftFlags = classifyShift(shift.shift_date, shift.start_time, shift.end_time);

        // Score each employee for this shift
        const candidateScores = employees.map(emp => {
            const currentAssignments = assignedByEmployee.get(emp.id) ?? [];
            const existingShifts = existingRoster.get(emp.id) ?? [];
            
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
                        duration_minutes: durationMinutes(s.start_time, s.end_time),
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
            //
            // The denominator is the WINDOW obligation passed in by `run()`,
            // not `employeeDetails.min_contract_minutes` — nothing populates
            // that field, so it was 0 for every employee and this whole term
            // was inert: a penalty that could never fire and a bonus that was
            // the same constant for everyone, cancelling out of the argmax. The
            // fallback consequently never preferred an under-loaded permanent
            // over a casual, which is the FT starvation HC-7 exists to prevent
            // — in the path that runs precisely when the optimizer is unhealthy
            // and nobody is watching. See `windowContractObligationMinutes`,
            // `inWindowScheduledMinutes` and `greedyUtilizationTerms` for the
            // scale and zero-obligation reasoning behind each input.
            const details = employeeDetails.get(emp.id);
            const contractedMins = windowObligation?.get(emp.id) ?? 0;
            const scheduledMins = inWindowScheduledMinutes(
                totalShiftsForEmp as { shift_date?: string; duration_minutes?: number }[],
                windowStartDate,
            );

            // Strategy multipliers — `strategyMult` is the shared mirror of
            // optimizer-service/model_builder.py `_strategy_mult`.
            // cost_weight is honoured only by the Python OR-Tools optimizer; the greedy
            // fallback does not compute per-shift cost and leaves that term at default.
            const fairnessWeight = resolvedStrategy.fairness_weight ?? 50;
            const fatigueMult  = strategyMult(resolvedStrategy.fatigue_weight ?? 50);
            const fairnessMult = strategyMult(fairnessWeight);

            // Penalty Calculation
            // Fatigue past the "ok" band is penalised quadratically, scaled by
            // fatigue_weight. The knee is FATIGUE_BANDS.OK_MAX so the fallback
            // starts penalising at exactly the point the FTG badge turns amber —
            // it used to knee at a bare `15`, below the UI's own 20, so a
            // manager saw green for someone the fallback was already avoiding
            // (audit F-23).
            const fatiguePenalty = health.projected > FATIGUE_BANDS.OK_MAX
                ? Math.pow(health.projected - FATIGUE_BANDS.OK_MAX, 2) * 50 * fatigueMult
                : 0;
            // Over-utilization (> 100%) is a hard over-cap, not a strategy
            // lever; under-utilization (< 80%) earns a fairness bonus scaled by
            // fairness_weight. Both are neutral without a contract — see
            // `greedyUtilizationTerms`.
            const { utilization: utl, penalty: utilizationPenalty, bonus: fairnessBonus } =
                greedyUtilizationTerms(scheduledMins, contractedMins, fairnessMult);

            // F1 Ledger bias — the SHARED scoring kernel, identical to the
            // solver's SC-11 (audit F-10/F-13). This block used to hardcode 50¢
            // per debt unit where the solver uses 300¢/500¢, and contained a
            // leftover duplicated line that counted the negative-weekend-debt
            // bonus TWICE, so the fallback over-preferred weekend assignment by
            // 2× relative to night and 6× weaker than the solver overall.
            // Sign note: `shiftFairnessPenaltyCents` returns a PENALTY (positive
            // = bias away), and this scorer maximises, so it is subtracted.
            const debts = details?.fairness_debts;
            const debtBonus = -shiftFairnessPenaltyCents(debts, shiftFlags, fairnessWeight);

            // Preference discount/bonus
            const pref = new Set(details?.preferred_shift_ids || []);
            let preferenceBonus = 0;
            if (pref.has(shift.id)) {
                preferenceBonus += 50; // base preference bonus ($5.00 equivalent)
                // Owed-preference boost, via the same coefficient table the
                // solver uses (2000¢/rate-unit) rather than a local 20.
                // One-sided by design — a BELOW-average denial rate must not
                // penalise you for bidding successfully.
                preferenceBonus += Math.max(
                    0,
                    debtToObjectiveCoeff(debts?.denial_rate ?? 0, 'denial_rate', fairnessWeight),
                );
            }

            const score = 1000 - fatiguePenalty - utilizationPenalty + fairnessBonus + debtBonus + preferenceBonus;

            return { 
                emp, 
                score, 
                fatigueScore: health.projected,
                utilization: utl 
            };
        });

        // Try employees in order of highest score
        const sorted = candidateScores
            .filter(c => {
                // Role-set eligibility — mirrors the solver's employee_eligible
                // and the manual/bulk R10 rule: an employee may work a shift only
                // if they hold a contract for the shift's role. (Replaces the old
                // numeric level-hierarchy gate, which let any higher-level person
                // take lower-level work and diverged from the solver.) Skip when
                // the shift carries no role requirement.
                if (shift.role_id) {
                    const roles = c.emp.contracted_role_ids ?? [];
                    if (!roles.includes(shift.role_id)) return false;
                }

                // HC-EmploymentType: kept as a SOFT preference upstream in
                // the optimizer (see SC-1 Employment Isolation). Don't
                // hard-reject here — that would block legitimate
                // cross-assignments when the right pool is exhausted.
                
                return true;
            })
            .sort((a, b) => b.score - a.score);

        if (sorted.length === 0) {
            console.debug('[AutoScheduler] No eligible employees for shift %s (Role/Skill mismatch)', shift.id);
        }

        for (const candidate of sorted) {
            const { emp } = candidate;
            
            // No overqualification penalty (single-mode policy): holding a
            // role's contract makes that shift a legitimate assignment, so a
            // multi-role employee is not penalised for taking a lower role.
            const finalScore = candidate.score;

            const existingV8ShiftIds = assignedByEmployee.get(emp.id) ?? [];
            const candidateIds = [...existingV8ShiftIds, shift.id];

            try {
                // Build injected context from pre-fetched maps
                const details = employeeDetails.get(emp.id);
                const existing = existingRoster.get(emp.id) ?? [];
                
                // Only simulate if they passed the basic pre-filters above
                const simResult = await bulkAssignmentController.simulate(
                    candidateIds,
                    emp.id,
                    { 
                        mode: 'PARTIAL_APPLY',
                        injectedData: {
                            candidateShifts: shifts.filter(s => candidateIds.includes(s.id)) as any,
                            existingShifts: existing.map(e => ({
                                id: e.id,
                                shift_date: e.shift_date,
                                start_time: e.start_time,
                                end_time: e.end_time,
                                assigned_employee_id: emp.id,
                                unpaid_break_minutes: e.unpaid_break_minutes ?? 0,
                            })) as any,
                            employee: {
                                id: emp.id,
                                name: emp.name,
                                contracts: details?.contracts || [],
                                qualifications: details?.qualifications || [],
                                // Same reason as the solver path: without the raw
                                // contract status V8_EMPLOYMENT_TARGET cannot fire,
                                // and greedy would hand back the same off-target
                                // assignments the DB trigger rejects.
                                employment_statuses: emp.employment_status
                                    ? [emp.employment_status]
                                    : undefined,
                            } as any
                        }
                    },
                );
                const shiftResult = simResult.results.find(r => r.shiftId === shift.id);
                if (shiftResult?.passing) {
                    assignedByEmployee.get(emp.id)!.push(shift.id);
                    proposals.push({
                        shiftId: shift.id,
                        employeeId: emp.id,
                        employeeName: emp.name,
                        shiftDate: shift.shift_date,
                        startTime: shift.start_time,
                        endTime: shift.end_time,
                        optimizerCost: 0,
                        employmentType: /casual/i.test(emp.contract_type || '') ? 'Casual' : 'Full-Time',
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
            proposals.push({
                shiftId: shift.id,
                employeeId: '',
                employeeName: '',
                shiftDate: shift.shift_date,
                startTime: shift.start_time,
                endTime: shift.end_time,
                optimizerCost: 0,
                employmentType: 'Casual',
                complianceStatus: 'FAIL',
                violations: [{ type: 'NO_ELIGIBLE_EMPLOYEE', description: 'No available employee passed compliance for this shift.', blocking: true }],
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
        if (input.shifts.length > MAX_OPTIMIZER_SHIFTS) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many shifts (${input.shifts.length}). The optimizer accepts at most ${MAX_OPTIMIZER_SHIFTS} per run — narrow the date range.`,
            );
        }
        if (input.employees.length > MAX_OPTIMIZER_EMPLOYEES) {
            throw new AutoSchedulerInputTooLargeError(
                `Too many employees (${input.employees.length}). The optimizer accepts at most ${MAX_OPTIMIZER_EMPLOYEES} per run — narrow the scope filter.`,
            );
        }

        const throwIfAborted = () => {
            if (input.signal?.aborted) {
                throw new DOMException('AutoScheduler run aborted', 'AbortError');
            }
        };

        const t0 = performance.now();
        console.debug('[AutoScheduler] Starting — shifts=%d employees=%d', input.shifts.length, input.employees.length);

        // ── Layer 0: Demand-vs-supply pre-check ──────────────────────────────
        // Cheap arithmetic check before we burn CPU on the solver. Surfaces
        // mathematically-impossible days (more shift-hours than worker-hours)
        // that would otherwise just appear as silently uncovered shifts.
        const capacityCheck = this._capacityCheck(input.shifts, input.employees, input.employeeDetails);
        if (!capacityCheck.sufficient) {
            console.warn(
                '[AutoScheduler] Capacity deficit detected on %d day(s) — total deficit %d min',
                capacityCheck.deficitDays.length,
                capacityCheck.deficitDays.reduce((a, d) => a + d.deficitMinutes, 0),
            );
        }

        // ── Roster awareness: fetch existing committed shifts ────────────────
        // Without this, the optimizer is blind to shifts already assigned to
        // these employees (e.g. from a previous Apply within the same session
        // or work scheduled outside the current planner view). The solver
        // will then propose conflicting work that compliance rejects, so a
        // re-optimize collapses from many passing proposals to almost none.
        const existingRoster = await rosterFetcher.fetchExistingRoster(
            input.shifts, input.employees,
        );
        // ── Availability awareness: fetch declared slots ─────────────────────
        // Used as a hard filter in `employee_eligible` on the Python side.
        // Policy: an employee with zero availability records on file is
        // treated as universally available (not yet onboarded); an employee
        // with *any* records on file is treated as unavailable for any
        // shift not covered by a declared slot in the optimization window.
        const availabilityData = await rosterFetcher.fetchAvailability(
            input.shifts, input.employees,
        );
        // ── Leave awareness (audit F1): approved leave = LEGAL-HARD ──────────
        // Approved leave dates feed the solver's per-day `unavailable_dates`
        // hard exclusion, so an employee on leave can never be proposed for
        // those days. Leave wins over coverage (legal_hard » coverage), same
        // tier as the other statutory caps.
        const leaveByEmployee = await rosterFetcher.fetchApprovedLeave(
            input.shifts, input.employees,
        );
        // ── Pending leave: SOFT, not hard ────────────────────────────────────
        // A request is not a decision. Hard-excluding it would let anyone take
        // themselves off the roster by asking, so it becomes a 5000c penalty
        // the solver routes around when it cheaply can — which is enough to
        // stop the common failure: autopilot rosters someone into leave that is
        // approved two days later, and the only remedy left is the manual
        // post-approval unassign flow.
        const pendingLeaveByEmployee = await rosterFetcher.fetchPendingLeave(
            input.shifts, input.employees,
        );
        // Employee-declared exceptions — the first producer this channel has
        // ever had. Subtractive, so unlike an availability declaration a narrow
        // one cannot un-roster the person who wrote it.
        const exceptionsByEmployee = await rosterFetcher.fetchAvailabilityExceptions(
            input.shifts, input.employees,
        );
        // ── Contract-derived classification (compliance audit finding —
        // 2026-08-02): real Schedule 1/2 level, Schedule 3 Security status,
        // and Schedule 4/5/6 apprentice/trainee/SWS category from each
        // employee's Active `user_contracts` row. Caller-supplied
        // `employeeDetails` still wins per-field where present — see
        // `mergeEmployeeDetails`.
        const contractDetails = await rosterFetcher.fetchEmployeeContractDetails(input.employees);
        const employeeDetails = mergeEmployeeDetails(contractDetails, input.employeeDetails);
        throwIfAborted();

        // Contract ordinary-hours envelopes (solver HC-5e). Read separately from
        // the classification columns above on purpose — see
        // `fetchOrdinaryHoursEnvelopes`. Empty map = every contract unrestricted,
        // which is production's current state and a safe one.
        const envelopes = await rosterFetcher.fetchOrdinaryHoursEnvelopes(input.employees);
        throwIfAborted();
        const totalExisting = Array.from(existingRoster.values())
            .reduce((acc, list) => acc + list.length, 0);
        if (totalExisting > 0) {
            console.debug(
                '[AutoScheduler] Roster context: %d existing shifts across %d employees',
                totalExisting, existingRoster.size,
            );
        }

        // ── Layer 0.5: Past + emergent shift identification ──────────────────
        // Shifts that have already started can never be assigned. Shifts inside
        // the emergent window (TTS ≤ 4h) are excluded too: bids and swaps are
        // already locked server-side at that point, and last-minute coverage
        // must go through the emergency-assignment flow, not a bulk optimize.
        // Both buckets skip the solver AND the greedy fallback, and surface as
        // blocking violations so the user sees why they were not assigned.
        const now = Date.now();
        const pastShifts: ShiftMeta[] = [];
        const emergentShifts: ShiftMeta[] = [];
        const futureShifts: ShiftMeta[] = [];

        for (const s of input.shifts) {
            // Re-use logic from IncrementalValidator but on ShiftMeta.
            // ShiftMeta has no start_at, so resolve the authored Sydney
            // wall-clock (shift_date + start_time) to an absolute instant.
            const start = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
            if (start.getTime() <= now) {
                pastShifts.push(s);
            } else if (start.getTime() - now <= EMERGENT_WINDOW_MS) {
                emergentShifts.push(s);
            } else {
                futureShifts.push(s);
            }
        }

        if (pastShifts.length > 0 || emergentShifts.length > 0) {
            console.debug(
                '[AutoScheduler] Excluding %d past and %d emergent (TTS ≤ 4h) shifts from optimizer',
                pastShifts.length, emergentShifts.length,
            );
        }

        // Failed-proposal stubs for the excluded shifts — appended to every
        // result path (optimizer and greedy) so UI accounting stays complete.
        const unschedulableProposal = (s: ShiftMeta, type: 'PAST_SHIFT' | 'EMERGENT_SHIFT', description: string): ValidatedProposal => ({
            shiftId: s.id,
            employeeId: '',
            employeeName: '',
            shiftDate: s.shift_date,
            startTime: s.start_time,
            endTime: s.end_time,
            optimizerCost: 0,
            employmentType: 'Casual',
            complianceStatus: 'FAIL',
            violations: [{ type, description, blocking: true }],
            passing: false,
        });
        const excludedProposals: ValidatedProposal[] = [
            ...pastShifts.map(s => unschedulableProposal(s, 'PAST_SHIFT', 'This shift has already started and cannot be assigned.')),
            ...emergentShifts.map(s => unschedulableProposal(s, 'EMERGENT_SHIFT', 'This shift starts within 4 hours — use the emergency assignment flow instead of the autoscheduler.')),
        ];
        const excludedShiftIds = excludedProposals.map(p => p.shiftId);

        // ── Layer 1: Build optimizer request ─────────────────────────────────
        const dates = input.shifts.map(s => s.shift_date).sort();
        const start = new Date(dates[0]);
        const end = new Date(dates[dates.length - 1]);
        const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const weekScale = diffDays / 7;

        console.debug('[AutoScheduler] Scaling limits for %f week(s) (%d days)', weekScale.toFixed(2), diffDays);

        const optimizerShifts: OptimizerShift[] = futureShifts.map(s => {
            // Day-type flags (audit F-01). These were declared on OptimizerShift and
            // read by the solver — `_penalty_day` for the cl 41 loadings, and
            // `undesirable_shift_ids` for the SC-10/SC-11 fairness terms — but no
            // producer ever set them, so `is_sunday`/`is_public_holiday` arrived
            // permanently false: Sunday and PH work was priced at ordinary rates and
            // was invisible to every fairness balancing term (the
            // `public_holiday_shifts` debt branch was unreachable outright).
            // Resolved via the app-wide holiday helper — never a local literal set
            // and never `new Date(dateStr)`, which parses as UTC midnight and rolls
            // the day for any viewer west of UTC.
            const dayType = getShiftDayType(s.shift_date);
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
                level: s.level ?? 0,
                is_training: (s as any).is_training ?? false,
                unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
                is_sunday: dayType.isSunday,
                is_public_holiday: dayType.isPublicHoliday,
            };
        });

        // Total demand across the window — used to cap per-employee minimum
        // obligations so HC-7 (min contract hours) cannot dominate HC-1
        // (coverage). Without this cap, on a long horizon `weekScale` blows
        // up the min-contract obligation past the total available demand,
        // and the solver leaves shifts uncovered to satisfy the floor.
        const totalDemandMinutes = futureShifts.reduce(
            (acc, s) => acc + durationMinutes(s.start_time, s.end_time),
            0,
        );

        // Weekly contracted minimum per employee, resolved ONCE here so the
        // fair-share caps and the obligation sent to the solver cannot drift
        // apart. See `baselineWeeklyContractMinutes` /
        // `resolveContractObligationMinutes` for why each input is shaped the
        // way it is.
        const weeklyContractMinutes = new Map<string, number>(
            input.employees.map(e => [
                e.id,
                employeeDetails.get(e.id)?.min_contract_minutes
                    ?? baselineWeeklyContractMinutes(e.contract_type),
            ]),
        );
        const fairShareCaps = buildFairShareCaps(totalDemandMinutes, weeklyContractMinutes);

        // Uncapped, leave-credited window obligation. The solver gets the
        // CAPPED figure (its objective needs the safety valve); the greedy
        // fallback's utilization ratio gets this one, because the cap answers
        // "how much work is there" and a utilization denominator has to answer
        // "how much is this person owed".
        const windowObligationMinutes = new Map<string, number>(
            input.employees.map(e => [
                e.id,
                windowContractObligationMinutes(
                    weeklyContractMinutes.get(e.id) ?? 0,
                    weekScale,
                    (leaveByEmployee.get(e.id) ?? []).length,
                ),
            ]),
        );

        // F1 Ledger: fetch cumulative fairness debts for the optimizer run.
        // Requires a real org scope. When absent we SKIP entirely rather than
        // invent one — the ledger's organization_id is a uuid, so a fabricated
        // value would error and silently disable the feature anyway.
        const orgId = input.organizationId;
        let debtsMap: Map<string, Record<string, number>> | null = null;
        // Audit F-04: record WHY the ledger did or didn't influence this run. An
        // empty debts map used to be indistinguishable from "nobody owes
        // anything", so longitudinal fairness could be silently off for weeks.
        let ledgerStatus: FairnessLedgerRunStatus = {
            applied: false, reason: 'no_org_scope',
            employeesWithDebts: 0, windowEnd: null, ageDays: null,
        };
        if (orgId) {
            try {
                const read = await fairnessLedgerService.getEmployeeDebtsWithStatus(
                    orgId,
                    input.employees.map(e => e.id),
                );
                debtsMap = debtsToMap(read.debts);
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

        // Effective-dated EA rate set for the window (audit F6): the solver's
        // cost ranking must track classification AND CPI increases, never a
        // frozen L1 snapshot. Resolved once at the window start.
        const windowRateSet = resolveRateSet(dates[0]);

        // Best-effort "is this employee Security" signal for the current batch —
        // see `deriveSecurityRoleIds`/`resolveSecurityAnnualisedRate` above.
        const securityRoleIds = deriveSecurityRoleIds(input.shifts);

        const optimizerEmployees: OptimizerEmployee[] = input.employees.map(e => {
            const det = employeeDetails.get(e.id);
            const isFT = e.contract_type === 'FT' || /full/i.test(e.contract_type || '');
            const isPT = e.contract_type === 'PT' || /part/i.test(e.contract_type || '');
            const isCasual = /casual/i.test(e.contract_type || '');

            const isSecurityEmployee = det?.is_security_role
                ?? (e.contracted_role_ids ?? []).some(id => securityRoleIds.has(id));
            const securityRate = resolveSecurityAnnualisedRate(windowRateSet, {
                isFullTime: isFT, isSecurityEmployee, level: det?.level,
            });

            // Default to 38h/wk (2280m) if FT, 20h/wk (1200m) if PT, else 40h/wk max for Casuals
            const baseMax = isFT ? 2280 : isPT ? 1200 : 2400;

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

            // Classification-resolved rate: explicit per-employee rate wins;
            // otherwise Schedule 2 by level (casual vs permanent column);
            // unknown level (0/undefined = "not classified") → conservative
            // defaultRate. Never a hardcoded literal (goes stale at each CPI).
            const levelKey = det?.level && det.level >= 1 && det.level <= 7
                ? (`LEVEL_${det.level}` as keyof typeof windowRateSet.wageRates)
                : null;
            const scheduleRate = levelKey
                ? (isCasual ? windowRateSet.wageRates[levelKey].casual : windowRateSet.wageRates[levelKey].permanent)
                : null;

            return {
                id: e.id,
                name: e.name,
                contract_type: e.contract_type,
                contracted_role_ids: e.contracted_role_ids ?? [],
                is_security_role: isSecurityEmployee,

                hourly_rate: e.remuneration_rate ?? securityRate ?? scheduleRate ?? windowRateSet.defaultRate,
                contract_weekly_minutes: (e.contracted_weekly_hours || 38) * 60,
                level: det?.level ?? 0,
                // `employeeDetails` never sets is_flexible (fetchEmployeeContractDetails
                // does not select employment_status), so this was permanently false and
                // no one could ever satisfy a `target_requires_flexible` shift. Prefer
                // the value EligibilityService already resolved from the in-scope
                // contract; fall back to the details map for other callers.
                is_flexible: e.is_flexible ?? det?.is_flexible ?? false,
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
                employment_type: e.employment_status
                    ? toTargetEmploymentType(e.employment_status)
                    : /casual/i.test(e.contract_type || '') ? 'Casual' : isPT ? 'Part-Time' : 'Full-Time',
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

        // HC-7 obligation summary. The solver cannot report an obligation it is
        // unable to discharge — it absorbs the Tier-1 slack silently — so the
        // only place the shape of that obligation is visible is here. `capped`
        // is the count whose contract floor was cut by the fair-share cap
        // rather than by leave: a persistently high number means the window
        // holds less work than the permanent workforce is owed.
        if (weeklyContractMinutes.size > 0) {
            const obligated = optimizerEmployees.filter(o => (o.min_contract_minutes ?? 0) > 0);
            let capped = 0;
            let leaveCredited = 0;
            for (const e of input.employees) {
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
                input.employees.length,
                Math.round(obligated.reduce((a, o) => a + (o.min_contract_minutes ?? 0), 0) / 60),
                weekScale.toFixed(2),
                leaveCredited,
                capped,
            );
        }

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
        // Auto-scale the solver budget with problem size. Preprocess time
        // grows roughly linearly with raw_pairs; large rosters (e.g. 624
        // shifts × 103 employees → ~64k vars / 1.5M constraints) need
        // ~7-8s of preprocess + adequate solve time on top. A flat 30s cap
        // forces those runs to time out and engage greedy unnecessarily.
        const rawPairs = optimizerShifts.length * optimizerEmployees.length;
        // Extra wall-clock headroom for the largest monthly rosters. This
        // composes with the solver's front-loaded per-tier time allocation,
        // giving heavy runs enough budget to finish instead of timing out.
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
                // Availability is a HARD constraint for the auto-scheduler: unset =
                // unavailable, and the solver may never place a shift outside a
                // declared block. Forced on regardless of caller-supplied constraints.
                constraints: { min_rest_minutes: 600, relax_constraints: false, ...input.constraints, enforce_availability: true },
                // B1 — single-mode: always send the pinned policy (no sliders).
                strategy: SINGLE_MODE_STRATEGY,
                solver_params: {
                    max_time_seconds: solverBudget,
                    num_workers: input.numWorkers ?? 8,
                    compute_alternatives: input.computeAlternatives ?? false,
                    // Large month-long rosters time-starve the fairness/cost
                    // tiers on one monolithic solve. For big problems, decompose
                    // by ISO week (solver pins prior weeks → cross-week rest,
                    // hour caps and cumulative fairness are preserved). The
                    // solver auto-skips to monolithic when the range is <2 weeks,
                    // so this is safe for any large single-week problem too.
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
                // Past/emergent shifts are excluded from greedy too — appended
                // back as failed proposals so they stay visible in the UI.
                validatedProposals = await greedyFallback(futureShifts, input.employees, employeeDetails, existingRoster, input.strategy, windowObligationMinutes);
                validatedProposals.push(...excludedProposals);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                // ── Parse + compliance validate ───────────────────────────────
                const { shiftMap, employeeMap } = solutionParser.buildMaps(input.shifts, input.employees);
                const { groups, uncoveredV8ShiftIds: uncov } = solutionParser.parse(optimizeResponse, shiftMap, employeeMap);
                
                // Add back the past/emergent shifts as uncovered (optimizer never saw them)
                uncoveredV8ShiftIds = [...uncov, ...excludedShiftIds];

                const validationStart = performance.now();
                validatedProposals = await this._validateProposals(
                    groups,
                    employeeDetails,
                    existingRoster,
                    employeeMap
                );

                // Add back the past/emergent shifts as explicitly failed proposals (for UI visibility)
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
                validatedProposals = await greedyFallback(futureShifts, input.employees, employeeDetails, existingRoster, input.strategy, windowObligationMinutes);
                validatedProposals.push(...excludedProposals);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredV8ShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                throw err;
            }
        }
        throwIfAborted();

        // ── Layer 2.4: Compliance repair — re-home rejected assignments ───────
        // Maximise COMPLIANT coverage. Any shift whose optimizer assignment
        // failed the compliance validator is re-solved onto a DIFFERENT compliant
        // employee (the failing pair is excluded), pinning the kept roster so
        // cross-assignment rest/hours still hold. Bounded + best-effort: it never
        // blocks the preview, and only runs on the real optimizer path (greedy
        // fallback has no solver to re-solve). Whatever still can't be placed
        // compliantly is left uncovered by the hard gate below.
        if (!usedFallback && validatedProposals.some(p => !p.passing)) {
            throwIfAborted();
            const repairStart = performance.now();
            const before = validatedProposals.filter(p => !p.passing).length;
            validatedProposals = await this._repairCompliance({
                proposals: validatedProposals,
                optimizerShifts,
                optimizerEmployees,
                inputShifts: input.shifts,
                inputEmployees: input.employees,
                employeeDetails,
                existingRoster,
                // Availability is a HARD constraint for the auto-scheduler: unset =
                // unavailable, and the solver may never place a shift outside a
                // declared block. Forced on regardless of caller-supplied constraints.
                constraints: { min_rest_minutes: 600, relax_constraints: false, ...input.constraints, enforce_availability: true },
                budgetSeconds: Math.min(30, Math.max(10, Math.round(solverBudget / 4))),
                signal: input.signal,
            });
            const after = validatedProposals.filter(p => !p.passing).length;
            console.info(
                '[AutoScheduler] Compliance repair: re-homed %d of %d rejected shift(s) in %dms (%d left uncovered for compliance)',
                before - after, before, Math.round(performance.now() - repairStart), after,
            );
        }

        // ── Layer 2.5: Enrich with Health Metrics (Fatigue/Fairness/Cost) ────
        // We calculate production-grade metrics for all proposals to ensure
        // the manager has an accurate audit of the projected roster health.
        if (validatedProposals.length > 0) {
            const employeeMap = new Map(input.employees.map(e => [e.id, e]));
            // cl 42 weekly OT for the greedy-fallback re-estimate (compliance
            // audit finding — 2026-08-02) — see buildGreedyFallbackPriorOrdinaryMap.
            // A no-op (undefined lookups) on the optimizer path, since it's only
            // consulted inside the `usedFallback` branch below.
            const fallbackPriorOrdinaryMap = usedFallback
                ? buildGreedyFallbackPriorOrdinaryMap(validatedProposals, existingRoster)
                : new Map<string, number>();

            for (const p of validatedProposals) {
                if (!p.employeeId) continue;
                const emp = employeeMap.get(p.employeeId);
                const shift = input.shifts.find(s => s.id === p.shiftId);

                // 1. Cost (dollars, AUD)
                // On the optimizer path the solver already returned the
                // per-assignment cost it actually optimized — it is threaded
                // here as `p.optimizerCost` (set from `proposal.cost` in
                // `_validateProposals`, which originates in solution-parser).
                // That solver value IS the single source of truth and is what
                // the pillar "Labour cost" (`pillars.cost.total`) sums, so the
                // grid "Total Cost" reconciles with the pillar only if we leave
                // it untouched. Re-estimating client-side via `estimateShiftCost`
                // here is a different cost engine that diverges by ~15%.
                //
                // The greedy fallback never calls the optimizer, so no solver
                // cost exists — in that case we DO re-estimate. Both engines
                // return dollars, so no unit conversion is needed.
                if (usedFallback && shift && emp) {
                    // cl 36.1 vs Sch.3 §3.2/§5.3: the unpaid meal break is
                    // deducted for general staff, but Security meal breaks are
                    // PAID — the full clock span is priced. `durationMinutes()`
                    // alone is the GROSS span with no break subtraction at all;
                    // compliance audit finding (2026-08-02): this previously
                    // priced every fallback shift's unpaid break as paid time.
                    const empDet = employeeDetails.get(emp.id);
                    const isSecurityShift = empDet?.is_security_role
                        ?? (shift.roleName?.toLowerCase().includes('security') ?? false);
                    const grossMins = durationMinutes(shift.start_time, shift.end_time);
                    const mins = isSecurityShift
                        ? grossMins
                        : Math.max(0, grossMins - (shift.unpaid_break_minutes ?? 0));
                    const employmentType = emp.contract_type === 'CASUAL' || /casual/i.test(emp.contract_type || '')
                        ? 'Casual'
                        : /part/i.test(emp.contract_type || '') ? 'Part-Time' : 'Full-Time';
                    // Object-based call (replaces the former 32-positional-argument
                    // legacy wrapper — an auditability risk the compliance audit
                    // flagged: a silent argument-order mistake would compile
                    // without error). Also wires cl 42 weekly OT — previously
                    // absent from the AutoScheduler's own pre-commit estimate even
                    // though the roster-grid projection pipeline already had it.
                    p.optimizerCost = estimateDetailedShiftCostObj({
                        netMinutes: mins,
                        start_time: shift.start_time,
                        end_time: shift.end_time,
                        rate: emp.remuneration_rate ?? 25,
                        scheduled_length_minutes: mins,
                        is_overnight: (shift as any).is_overnight ?? false,
                        is_cancelled: false,
                        shift_date: shift.shift_date,
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
                        priorOrdinaryHoursThisWeek: fallbackPriorOrdinaryMap.get(p.shiftId),
                    }).totalCost;
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
                        unpaid_break_minutes: input.shifts.find(s => s.id === pr.shiftId)?.unpaid_break_minutes ?? 0
                    })),
                ];

                p.fatigueScore = calculateFatigueWithRecovery(
                    totalShifts as any,
                    p.shiftDate,
                ).current;

                // 3. Calculate Utilization (Fairness)
                const scheduledMins = totalShifts.reduce((acc, s) => acc + (s as any).duration_minutes || 0, 0);
                const contractedMins = (emp?.max_weekly_minutes ?? 2400) * weekScale;
                p.utilization = calculateUtilization(scheduledMins / 60, contractedMins / 60);
            }
        }

        // ── Compliance is a HARD gate ─────────────────────────────────────────
        // A non-compliant assignment is NEVER applied (commit() drops it at the
        // recheck step), so it must not be presented as a "proposal" either —
        // otherwise the scorecard shows <100% compliance for a roster we would
        // never actually book. Reclassify every failing proposal as an UNCOVERED
        // shift: the applied roster is then 100% compliant BY CONSTRUCTION, and
        // coverage honestly reflects the compliant maximum the solver reached.
        const compliantProposals = validatedProposals.filter(p => p.passing);
        const droppedForCompliance = validatedProposals.filter(p => !p.passing);
        uncoveredV8ShiftIds = Array.from(
            new Set([...uncoveredV8ShiftIds, ...droppedForCompliance.map(p => p.shiftId)]),
        );

        const passing = compliantProposals.length;
        const failing = 0; // by construction — nothing non-compliant reaches the roster

        // Recompute coverage + cost pillars over the COMPLIANT set so the
        // scorecard matches what will actually be booked (the solver computed
        // them over every proposal, including the ones we just uncovered).
        // Fairness/wellbeing move only marginally and need solver-side
        // effective-minute state to recompute, so they are left as reported.
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

        // Tell the U5 banner WHY each compliance-dropped shift is uncovered (the
        // solver's own binding list only covers shifts it couldn't place at all).
        const complianceBinding = droppedForCompliance
            .filter(p => p.violations?.length)
            .map(p => ({
                shift_id: p.shiftId,
                eligible_count: 0,
                reason: (p.violations.find(v => v.blocking) ?? p.violations[0])?.description
                    ?? 'Left uncovered to keep the roster 100% compliant',
            }));

        const result: AutoSchedulerResult = {
            optimizerStatus,
            solveTimeMs,
            validationTimeMs,
            totalProposals: passing,        // compliant-only → compliance pillar reads 100%
            passing,
            failing,
            uncoveredV8ShiftIds,
            proposals: compliantProposals,  // only assignments we will actually book
            canCommit: passing > 0,
            usedFallback,
            capacityCheck,
            // Forward the per-category breakdown from the Python service.
            // Null when the greedy fallback path was taken (usedFallback=true)
            // because greedyFallback never calls the optimizer.
            objective_breakdown: optimizerObjectiveBreakdown,
            organizationId: input.organizationId,
            fairnessLedger: ledgerStatus,
            // B3/B5/B4 — single-mode transparency for the scorecard, constraint
            // banner, trade-off explorer, and per-shift "why" panel.
            pillars,
            bindingConstraints: [...(optimizerBinding ?? []), ...complianceBinding],
            alternatives: optimizerAlternatives,
            rationaleByShift: optimizerRationaleByShift,
        };



        // ── Layer 3: Audit uncovered shifts (the "Why") ───────────────────────
        if (result.uncoveredV8ShiftIds.length > 0 || result.failing > 0) {
            throwIfAborted();
            const auditStart = performance.now();
            
            // We audit both:
            // 1. Uncovered shifts (optimizer couldn't place)
            // 2. Failed shifts (optimizer placed but compliance rejected)
        const shiftsToAudit = [
                ...result.uncoveredV8ShiftIds,
                ...result.proposals.filter(p => !p.passing).map(p => p.shiftId)
            ];
            // Remove duplicates
            const uniqueAuditIds = Array.from(new Set(shiftsToAudit));

            result.uncoveredAudit = await auditor.audit({
                targetShiftIds: uniqueAuditIds,
                allShifts: input.shifts,
                allEmployees: input.employees,
                proposals: result.proposals,
                optimizerShifts,
                optimizerEmployees,
                // Availability is a HARD constraint for the auto-scheduler: unset =
                // unavailable, and the solver may never place a shift outside a
                // declared block. Forced on regardless of caller-supplied constraints.
                constraints: { min_rest_minutes: 600, relax_constraints: false, ...input.constraints, enforce_availability: true },
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
     *   2. Send the whole list to sm_bulk_assign_atomic via ONE RPC call with a
     *      per-attempt idempotency key (crypto.randomUUID). Atomic across all
     *      employees: a hard DB error writes nothing; a retry with the same key
     *      is a no-op. The RPC's lost-update guard skips any shift claimed by
     *      another employee since preview and returns it as a conflict.
     *   3. Map the RPC's per_employee breakdown back to CommitResult shape.
     *
     * NOTE: there is deliberately NO per-employee compliance re-simulation. The
     * preview validates with the optimizer's injected context (fresh data fetched
     * right before the solve) and the compliance hard gate guarantees the
     * proposals are 100% compliant; re-validating here via scenarioLoader's
     * DB-fetch path used a DIFFERENT data context and disagreed with the preview,
     * silently dropping ~23% of valid assignments. preview == commit now.
     *
     * Idempotency key is generated fresh per commit attempt so a manager
     * clicking Apply twice gets two independent attempts — each is idempotent
     * within itself (retry-safe) but does not deduplicate across attempts.
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
        // of valid assignments. The ONLY genuine apply-time concurrency concern —
        // a shift claimed by another employee since preview — is handled
        // atomically by sm_bulk_assign_atomic's lost-update guard, which skips
        // such shifts and returns them as conflicts. So what the preview approves
        // is exactly what books.
        const entries = Array.from(byEmployee.entries());
        const atomicAssignments = entries.map(([employeeId, shiftIds]) => ({ employeeId, shiftIds }));

        const idempotencyKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : undefined;

        const atomicResult = await assignmentCommitter.commitAtomic(atomicAssignments, idempotencyKey);

        // Failures/conflicts now come solely from the atomic RPC: a shift grabbed
        // by another employee since preview (lost-update guard → conflict), or a
        // hard DB error (→ failedEmployees).
        const allFailedEmployees = atomicResult.failedEmployees;
        const allConflicts = atomicResult.concurrencyConflicts;

        console.debug('[AutoScheduler] Atomic commit complete:', {
            totalCommitted: atomicResult.totalCommitted,
            failedEmployees: allFailedEmployees,
            concurrencyConflicts: allConflicts,
            idempotencyKey: idempotencyKey ?? 'none',
        });

        // ── F1 fairness-ledger write-back ─────────────────────────────────────
        // Record the shifts we actually committed so future runs see updated
        // weekend/night/PH/hours debts. Fire-and-forget: a ledger hiccup must
        // never fail an already-committed roster. Skipped when no org scope.
        if (result.organizationId && atomicResult.totalCommitted > 0) {
            const conflictSet = new Set(allConflicts);
            const proposalById = new Map(result.proposals.map(p => [p.shiftId, p]));
            const committedShifts: ShiftForFairness[] = [];
            for (const pair of atomicAssignments) {
                for (const shiftId of pair.shiftIds) {
                    if (conflictSet.has(shiftId)) continue;
                    const p = proposalById.get(shiftId);
                    if (!p) continue;
                    committedShifts.push({
                        id: shiftId,
                        employeeId: pair.employeeId,
                        shiftDate: p.shiftDate,
                        startTime: p.startTime,
                        endTime: p.endTime,
                    });
                }
            }
            if (committedShifts.length > 0) {
                fairnessLedgerService
                    .updateAfterCommit(result.organizationId, committedShifts)
                    .catch(err =>
                        console.error('[AutoScheduler] Fairness ledger write-back failed:', err),
                    );
            }
        }

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
        const dailyCapFor = (empId: string): number => {
            const det = employeeDetails?.get(empId) as Partial<OptimizerEmployee> | undefined;
            const weekly = det?.max_weekly_minutes;
            // Approximate daily cap as weekly / 5 if provided (matches typical
            // 5-day work weeks); else default.
            if (weekly && weekly > 0) return Math.round(weekly / 5);
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
        const supplyPerDay = employees.reduce((acc, e) => acc + dailyCapFor(e.id), 0);

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
        constraints: OptimizerConstraints;
        budgetSeconds: number;
        signal?: AbortSignal;
    }): Promise<ValidatedProposal[]> {
        const {
            proposals, optimizerShifts, optimizerEmployees, inputShifts, inputEmployees,
            employeeDetails, existingRoster, constraints, budgetSeconds, signal,
        } = args;
        const MAX_ITERS = 3;
        const SEP = '\x00';
        const shiftById = new Map(optimizerShifts.map(s => [s.id, s]));
        const { shiftMap, employeeMap } = solutionParser.buildMaps(inputShifts, inputEmployees);

        // Only retry genuine compliance failures with a known assignee — never a
        // PAST_SHIFT / EMERGENT_SHIFT (unfixable) or a SYSTEM error, and never
        // an empty employee.
        const isRepairable = (p: ValidatedProposal) =>
            !!p.employeeId && !(p.violations ?? []).some(v => v.type === 'PAST_SHIFT' || v.type === 'EMERGENT_SHIFT' || v.type === 'SYSTEM');

        let compliant = proposals.filter(p => p.passing);
        const failing = proposals.filter(p => !p.passing);
        const nonRepairable = failing.filter(p => !isRepairable(p));
        const pending = failing.filter(isRepairable);
        if (pending.length === 0) return proposals;

        const excluded = new Set<string>();
        const unresolved = new Map<string, ValidatedProposal>();
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
            const repairValidated = await this._validateProposals(groups, employeeDetails, augmentedRoster);

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
            // remaining compliant candidate → give up on it (leave uncovered).
            for (const sid of Array.from(unresolved.keys())) {
                if (!placed.has(sid)) unresolved.delete(sid);
            }
            if (newlyFailing.length === 0) break; // nothing new failed → converged
        }

        // Kept compliant + whatever still couldn't be re-homed (stays failing →
        // uncovered by the hard gate) + the unfixable failures.
        return [...compliant, ...Array.from(unresolved.values()), ...nonRepairable];
    }

    private async _validateProposals(
        groups: ReturnType<typeof solutionParser.parse>['groups'],
        employeeDetails: Map<string, Partial<OptimizerEmployee>>,
        existingRoster: Map<string, ExistingShiftRef[]>,
        employeeMap?: Map<string, EmployeeMeta>,
    ): Promise<ValidatedProposal[]> {
        const all: ValidatedProposal[] = [];

        // The employee's raw in-scope contract status, as an array because V8
        // models multi-contract staff. Omitted (rather than guessed) when the
        // caller has no employee map, keeping the rule fail-open exactly as
        // documented instead of inventing a status to match against.
        const employmentStatusesFor = (employeeId: string): string[] | undefined => {
            const status = employeeMap?.get(employeeId)?.employment_status;
            return status ? [status] : undefined;
        };

        // Aggregate compliance-failure diagnostics into ONE summary log at the
        // end, instead of one noisy console line per employee (100+ staff floods
        // the console and reads like an error storm).
        let failTotal = 0;
        const failedStaff = new Set<string>();
        const failByRule: Record<string, number> = {};

        for (const group of groups) {
            let bulkResult: BulkAssignmentResult;
            try {
                const details = employeeDetails.get(group.employeeId);
                const existing = existingRoster.get(group.employeeId) ?? [];

                bulkResult = await bulkAssignmentController.simulate(
                    group.shiftIds, 
                    group.employeeId, 
                    { 
                        mode: 'PARTIAL_APPLY',
                        injectedData: {
                            // Pass candidate shifts in their unassigned
                            // (draft) state. The bulk validator's Rule 2
                            // (`ALREADY_ASSIGNED`) rejects any shift whose
                            // `assigned_employee_id` is set — pre-stamping
                            // the optimizer's target employee here makes
                            // every proposal flunk validation. The intended
                            // assignee is conveyed via `group.employeeId`
                            // (the second argument to simulate()).
                            candidateShifts: group.proposals.map(p => ({
                                id: p.shiftId,
                                shift_date: p.shiftDate,
                                start_time: p.startTime,
                                end_time: p.endTime,
                                assigned_employee_id: null,
                                role_id: p.roleId,
                                lifecycle_status: 'draft',
                                unpaid_break_minutes: p.unpaidBreakMinutes ?? 0,
                                // Without these the rebuilt candidate loses its
                                // employment target and V8_EMPLOYMENT_TARGET goes
                                // silent, so this validator would keep ratifying
                                // assignments the DB trigger rejects.
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
                            })) as any,
                            employee: {
                                id: group.employeeId,
                                name: group.employeeName,
                                contracts: details?.contracts || [],
                                qualifications: details?.qualifications || [],
                                // V8_EMPLOYMENT_TARGET returns [] when this is
                                // empty, so the shift-side hydration above only
                                // takes effect once the employee side is present
                                // too. Raw contract status — NOT `contract_type`,
                                // which erases the Flexible Part-Time variant.
                                employment_statuses: employmentStatusesFor(group.employeeId),
                            } as any
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
                        violations: [{ type: 'SYSTEM', description: 'Compliance check error', blocking: true }],
                        passing: false,
                    });
                }
                continue;
            }

            const resultByShift = new Map(bulkResult.results.map(r => [r.shiftId, r]));

            // Diagnostic: accumulate WHICH rule disagrees with the solver, so the
            // single end-of-pass summary can report it. (The optimizer can return
            // 100% coverage while the validator rejects some proposals; those are
            // then left uncovered to keep the roster compliant.)
            const groupFail = bulkResult.results.filter(r => !r.passing).length;
            if (groupFail > 0) {
                failTotal += groupFail;
                failedStaff.add(group.employeeName);
                for (const r of bulkResult.results) {
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
                        type: v.violation_type, description: v.description, blocking: v.blocking,
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
