/**
 * Baseline FT — reading the world, computing a proposal, and applying it.
 *
 * THREE LAYERS, AND THE MIDDLE ONE IS PURE.
 *
 *   loadBaselineWorld  — I/O. Contracts, existing shifts, leave, public
 *                        holidays. Once per team and period.
 *   computeProposal    — PURE. No clock, no network, no randomness. Runs on
 *                        every keystroke in the pattern table.
 *   applyBaseline      — the only write. Creates the run record and the shifts.
 *
 * That split is what makes a live-editing table affordable. The expensive part
 * is reading the world; the part that changes when somebody types a new finish
 * time is the pure pipeline over data already in memory. The purity discipline
 * was originally adopted so idempotency could be unit-tested — it pays for
 * itself a second time here.
 *
 * THERE IS NO LONGER A "GENERATE" STEP. It existed to persist a proposal for a
 * later Apply; with the table recomputing continuously, persisting one per date
 * change would litter `baseline_ft_runs` and collide on its one-live-per-scope
 * index every time somebody clicked to the next week. The run record is now
 * written AT Apply, which is also the only moment it needs to exist as an audit
 * trail.
 *
 * A BLOCKING FINDING DROPS ONE EMPLOYEE, NEVER THE RUN. This changed with the
 * pattern model: when one template was shared by the whole sub-department, a
 * pattern-level failure meant nothing lawful could be built for anyone, so
 * aborting wholesale was right. Patterns are per-employee now, so one person's
 * unlawful pattern says nothing about their colleagues'.
 */

import { supabase } from '@/platform/supabase/client';
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import { availabilityModeForEmploymentStatus } from '@/modules/rosters/domain/availability-check';
import {
    cycleBoundsFor,
    toEpochDay,
    fromEpochDay,
} from '@/modules/compliance/ordinary-hours-cycle';
import type { V8Employee } from '@/modules/compliance/v8/types';
import type { Json } from '@/platform/supabase/types';

import { validatePattern } from '../domain/patternValidator';
import { computeCycleRequirements, isoWeekdayOf } from '../domain/requirementCalculator';
import { generateCandidates, type RunScope } from '../domain/candidateGenerator';
import { admitCandidates } from '../domain/admissionEngine';
import { attachLeaveCredit, patternHoursByWeekday } from '../domain/patternRow';
import type {
    BaselinePattern,
    Candidate,
    CycleRequirement,
    ExistingShift,
    Finding,
    RawLeaveDay,
} from '../domain/types';

import {
    loadEligibleEmployees,
    loadExistingShifts,
    loadLeaveDays,
    loadPublicHolidays,
    type EligibleEmployee,
} from './baselineFt.loaders';
import { inputDigest, snapshotVersion, type SnapshotShiftRef } from './digest';


/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

/** One employee's ledger, as the table's expanded row reads it. */
export interface EmployeeLedger {
    employeeId: string;
    name: string;
    requiredHours: number;
    existingHours: number;
    leaveHours: number;
    proposedHours: number;
    varianceHours: number;
    /** True when an unrecorded cl 55.1/58.2 election makes the figure ambiguous. */
    hasUnresolvedElection: boolean;
    cycles: CycleRequirement[];
    proposed: Candidate[];
    rejected: Array<{ candidate: Candidate; reasons: Finding[] }>;
    findings: Finding[];
    /**
     * This employee's pattern is unlawful, so nothing was proposed FOR THEM.
     *
     * Surfaced per row rather than as a run-level abort: their colleagues'
     * proposals stand, and the table shows exactly who is blocked and why.
     */
    patternBlocked: boolean;
}

export interface BaselineProposal {
    scope: RunScope & { organizationId: string; departmentId: string };
    periodStart: string;
    periodEnd: string;
    referenceDate: string;
    generatedAt: string;
    /** Stated on every run: the ordinary/overtime split is not rostering data. */
    axioms: string[];
    ledgers: EmployeeLedger[];
    runFindings: Finding[];
    totals: {
        employees: number;
        requiredHours: number;
        existingHours: number;
        leaveHours: number;
        proposedHours: number;
        varianceHours: number;
        proposedShiftCount: number;
        /** Employees whose pattern is unlawful. Apply refuses while any exist. */
        blockedEmployees: number;
    };
}

export class BaselineRunConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BaselineRunConflictError';
    }
}

/**
 * Stated on every run, so nobody has to infer it from the numbers.
 *
 * The ordinary/overtime split cannot be read from a roster, and no longer
 * pretends to be: `is_ordinary_hours` was a required field on the V8 shift
 * contract that every producer filled with a literal `true`, backed by no
 * column anywhere. It was removed rather than given a column, because a shift
 * is not wholly one or the other — under cl 42 the 38th and 39th hour of a
 * week can fall inside the same shift. That split belongs to payroll, which
 * already computes it per shift "post weekly-OT reclass" from hours actually
 * worked. Rostering counts every planned hour as ordinary, and says so.
 */
export const AXIOMS: string[] = [
    'All existing rostered hours are counted as ordinary hours. The system does not ' +
    'currently record whether a shift was worked as ordinary time or overtime.',
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ────────────────────────────────────────────────────────────────────────────
   1. The world
   ──────────────────────────────────────────────────────────────────────────── */

export interface BaselineWorld {
    employees: EligibleEmployee[];
    shiftsByEmployee: Map<string, ExistingShift[]>;
    /** Without credit hours — those depend on the pattern. See `attachLeaveCredit`. */
    leaveByEmployee: Map<string, RawLeaveDay[]>;
    publicHolidays: string[];
    snapshotRefs: SnapshotShiftRef[];
    rawContracts: Array<Record<string, unknown>>;
    findings: Finding[];
}

/**
 * Widen a date window to cover the WHOLE cycles it touches.
 *
 * Consumption must be counted over complete cycles: hours worked earlier in a
 * cycle fill the same ceiling as hours inside the roster period, so reading
 * only the period would understate what the employee has already done and
 * over-roster them. Reading extra days can only ever make the count more
 * complete, so widening is always the safe direction.
 */
export function widenToCycles(
    periodStart: string,
    periodEnd: string,
    anchors: ReadonlyArray<{ anchor: string; weeks: number }>,
): { from: string; to: string } {
    let from = toEpochDay(periodStart);
    let to = toEpochDay(periodEnd);
    for (const { anchor, weeks } of anchors) {
        const lo = cycleBoundsFor(periodStart, anchor, weeks);
        const hi = cycleBoundsFor(periodEnd, anchor, weeks);
        from = Math.min(from, toEpochDay(lo.start));
        to = Math.max(to, toEpochDay(hi.endInclusive));
    }
    return { from: fromEpochDay(from), to: fromEpochDay(to) };
}

/**
 * Everything the pure pipeline needs, read once for a team and a period.
 *
 * Employees are resolved FIRST because their declared cycles determine how far
 * the shift and leave reads have to be widened; the rest is then one parallel
 * round trip.
 */
export async function loadBaselineWorld(args: {
    subDepartmentId: string;
    periodStart: string;
    periodEnd: string;
}): Promise<BaselineWorld> {
    const { subDepartmentId, periodStart, periodEnd } = args;

    const { employees, findings, rawContracts } =
        await loadEligibleEmployees(subDepartmentId, periodStart, periodEnd);

    if (employees.length === 0) {
        return {
            employees: [], shiftsByEmployee: new Map(), leaveByEmployee: new Map(),
            publicHolidays: [], snapshotRefs: [], rawContracts, findings,
        };
    }

    const employeeIds = employees.map(e => e.facts.employeeId);
    const window = widenToCycles(periodStart, periodEnd,
        employees.map(e => ({ anchor: e.facts.cycleAnchor, weeks: e.facts.cycleWeeks })));

    const [{ shiftsByEmployee, snapshotRefs }, leaveByEmployee, publicHolidays] = await Promise.all([
        loadExistingShifts(employeeIds, window.from, window.to),
        loadLeaveDays(employeeIds, window.from, window.to),
        loadPublicHolidays(window.from, window.to),
    ]);

    return {
        employees, shiftsByEmployee, leaveByEmployee, publicHolidays,
        snapshotRefs, rawContracts, findings,
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   2. The proposal — PURE
   ──────────────────────────────────────────────────────────────────────────── */

export interface ComputeProposalInput {
    world: BaselineWorld;
    /** One pattern per employee. An employee with none proposes nothing. */
    patternsByEmployee: ReadonlyMap<string, BaselinePattern>;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    periodStart: string;
    periodEnd: string;
    /** Reference date for rule evaluation. Injected so runs are reproducible. */
    referenceDate: string;
    /** Injected rather than read from a clock, so this function stays pure. */
    generatedAt: string;
}

/**
 * Turn patterns plus the world into a proposal.
 *
 * PURE — same inputs, byte-identical output, every time. That is asserted
 * directly in the tests rather than hoped for, and it is what allows the table
 * to call this on every edit without a network round trip.
 */
export function computeProposal(input: ComputeProposalInput): BaselineProposal {
    const {
        world, patternsByEmployee, organizationId, departmentId, subDepartmentId,
        periodStart, periodEnd, referenceDate, generatedAt,
    } = input;

    const scope: RunScope = { subDepartmentId, periodStart, periodEnd };
    const runFindings: Finding[] = [...world.findings];

    // cl 38.1 — the roster is provided at least seven days ahead. This governs
    // PUBLICATION and Baseline only creates Drafts, so it warns and proceeds.
    const daysAway = toEpochDay(periodStart) - toEpochDay(referenceDate);
    if (daysAway < 7) {
        runFindings.push({
            severity: 'WARNING',
            code: 'BFT_SHORT_NOTICE',
            plain:
                `This period starts in ${Math.max(0, daysAway)} day(s). Rosters are provided to ` +
                `Team Members at least seven days before they begin, so publishing this may be ` +
                `short notice.`,
            clause: 'ICC EBA cl 38.1',
            overridable: true,
            calculation: { days_until_start: daysAway },
        });
    }

    if (world.employees.length === 0) {
        runFindings.push({
            severity: 'INFO',
            code: 'BFT_NO_ELIGIBLE_EMPLOYEES',
            plain: 'No wholly full-time employees are contracted to this sub-department for this period.',
            overridable: false,
        });
    }

    const ledgers: EmployeeLedger[] = [];

    for (const e of world.employees) {
        const facts = e.facts;
        const existing = world.shiftsByEmployee.get(facts.employeeId) ?? [];
        const rawLeave = world.leaveByEmployee.get(facts.employeeId) ?? [];

        const pattern: BaselinePattern = patternsByEmployee.get(facts.employeeId) ?? {
            employeeId: facts.employeeId,
            userContractId: facts.userContractId,
            subDepartmentId,
            slots: [],
        };

        // ── The pattern gate, per employee ───────────────────────────────────
        const patternFindings = validatePattern(pattern, facts, {
            isSecurityRole: e.isSecurityRole,
        }).map(f => ({ ...f, employeeId: f.employeeId ?? facts.employeeId }));

        const patternBlocked = patternFindings.some(f => f.severity === 'BLOCKING');

        // Credit hours come from THIS employee's pattern — cl 44.7 pays their
        // ordinary hours for the period, not a team average.
        const hoursByWeekday = patternHoursByWeekday(pattern);
        const leaveDays = attachLeaveCredit(rawLeave, hoursByWeekday, isoWeekdayOf);

        // The requirement is computed even for a blocked employee. What they
        // are OWED is a fact about their contract and has nothing to do with
        // whether their pattern is currently lawful — and hiding it would leave
        // the one row that needs attention as the one row with no numbers.
        const { cycles, findings: reqFindings } = computeCycleRequirements({
            facts,
            periodStart, periodEnd,
            existingShifts: existing,
            leaveDays,
            publicHolidays: world.publicHolidays,
            patternHoursByWeekday: hoursByWeekday,
        });

        let candidates: Candidate[] = [];
        let genFindings: Finding[] = [];
        if (!patternBlocked && pattern.slots.length > 0) {
            const generated = generateCandidates({
                facts, pattern, cycles,
                existingShifts: existing,
                periodStart, periodEnd, scope,
            });
            candidates = generated.candidates;
            genFindings = generated.findings;
        }

        const v8Employee: V8Employee = {
            id: facts.employeeId,
            name: e.name,
            contract_type: 'FULL_TIME',
            contracted_weekly_hours: facts.contractedWeeklyHours ?? 38,
            ordinary_hours_cycle_weeks: facts.cycleWeeks,
            ordinary_hours_cycle_anchor: facts.cycleAnchor,
            is_security_role: false,
            leave_days: leaveDays.filter(l => l.status === 'approved').map(l => l.date),
        };

        const { admitted, rejected, warnings } = admitCandidates({
            candidates,
            employee: v8Employee,
            existingShifts: existing,
            // Full-timers hold no declared slots by design; the mode is what
            // makes that silence read as "available by contract".
            availabilitySlots: [],
            availabilityMode: availabilityModeForEmploymentStatus('Full-Time'),
            referenceDate,
        });

        const requiredHours = cycles.reduce((s, c) => s + c.requiredHours, 0);
        const existingHours = cycles.reduce((s, c) => s + c.existingHours, 0);
        const leaveHours = cycles.reduce((s, c) => s + c.paidLeaveHours + c.publicHolidayCreditHours, 0);
        const proposedHours = admitted.reduce((s, c) => s + c.netMinutes / 60, 0);

        ledgers.push({
            employeeId: facts.employeeId,
            name: e.name,
            requiredHours: round1(requiredHours),
            existingHours: round1(existingHours),
            leaveHours: round1(leaveHours),
            proposedHours: round1(proposedHours),
            // Variance is what remains OWED after everything, including what we
            // are about to propose. Negative means already over-rostered.
            varianceHours: round1(requiredHours - existingHours - leaveHours - proposedHours),
            hasUnresolvedElection: cycles.some(
                c => Math.abs(c.deficitHours - c.deficitHoursIfElectionUnpaid) > 1e-9),
            cycles,
            proposed: admitted,
            rejected,
            findings: [...patternFindings, ...reqFindings, ...genFindings, ...warnings],
            patternBlocked,
        });
    }

    // Stable order: by name, then id. The table renders this directly, and a
    // list that reorders itself between recomputes is unusable to edit.
    ledgers.sort((a, b) => (a.name === b.name
        ? (a.employeeId < b.employeeId ? -1 : 1)
        : a.name.localeCompare(b.name)));

    const totals = ledgers.reduce((t, l) => ({
        employees: t.employees + 1,
        requiredHours: round1(t.requiredHours + l.requiredHours),
        existingHours: round1(t.existingHours + l.existingHours),
        leaveHours: round1(t.leaveHours + l.leaveHours),
        proposedHours: round1(t.proposedHours + l.proposedHours),
        varianceHours: round1(t.varianceHours + l.varianceHours),
        proposedShiftCount: t.proposedShiftCount + l.proposed.length,
        blockedEmployees: t.blockedEmployees + (l.patternBlocked ? 1 : 0),
    }), {
        employees: 0, requiredHours: 0, existingHours: 0, leaveHours: 0,
        proposedHours: 0, varianceHours: 0, proposedShiftCount: 0, blockedEmployees: 0,
    });

    return {
        scope: { ...scope, organizationId, departmentId },
        periodStart, periodEnd, referenceDate,
        generatedAt,
        axioms: AXIOMS,
        ledgers,
        runFindings,
        totals,
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   3. Apply — the only write
   ──────────────────────────────────────────────────────────────────────────── */

export interface ApplyRunResult {
    runId: string;
    created: number;
    skipped: Array<{ idempotencyKey: string; reason: string }>;
    status: 'applied' | 'partially_applied';
}

export interface ApplyBaselineInput {
    proposal: BaselineProposal;
    world: BaselineWorld;
    /** The `baseline_ft_patterns` rows behind the proposal, for the input digest. */
    patternRows: ReadonlyArray<Record<string, unknown>>;
    actorId: string;
    resolveTarget: (args: {
        subDepartmentId: string; departmentId: string; organizationId: string; shiftDate: string;
    }) => Promise<{
        rosterId: string; rosterSubgroupId: string;
        groupType: string; subGroupName: string;
    }>;
}

/**
 * Record the run, then create its shifts as DRAFTS.
 *
 * Everything is re-read at the point of writing. Nothing the proposal holds is
 * trusted, because the roster can move between the manager reading the table
 * and pressing the button — and a candidate that has become invalid is DROPPED
 * with a reason rather than forced through or allowed to abort its twenty
 * innocent neighbours.
 *
 * Writes go through `shiftsCommands.createShift`, never a raw insert, so the
 * shift-shape gate runs on the way past exactly as it does for every other
 * creation path in the product.
 */
export async function applyBaseline(input: ApplyBaselineInput): Promise<ApplyRunResult> {
    const { proposal, world, patternRows, actorId, resolveTarget } = input;
    const { organizationId, departmentId, subDepartmentId } = proposal.scope;

    const snapshot = snapshotVersion(world.snapshotRefs);
    const digest = inputDigest({
        subDepartmentId,
        periodStart: proposal.periodStart,
        periodEnd: proposal.periodEnd,
        patternSlots: patternRows,
        employees: world.rawContracts,
        snapshotVersion: snapshot,
        config: {
            enforce_ft_days_off: true,
            min_rest_gap_minutes: 600,
            referenceDate: proposal.referenceDate,
        },
    });

    // ── The run record ───────────────────────────────────────────────────────
    const { data: run, error: runErr } = await supabase
        .from('baseline_ft_runs')
        .insert({
            organization_id: organizationId,
            department_id: departmentId,
            sub_department_id: subDepartmentId,
            // NULL: this run came from `baseline_ft_patterns`, not a template.
            template_id: null,
            period_start: proposal.periodStart,
            period_end: proposal.periodEnd,
            snapshot_version: snapshot,
            input_digest: digest,
            proposal: proposal as unknown as Json,
            status: 'generated',
            created_by: actorId,
        } as never)
        .select('id')
        .single();

    if (runErr || !run) {
        // 23505 — the partial unique index fired. Another manager is applying
        // the same team and window right now. A deterministic conflict, which
        // is the point: two rival writes over the same dates need a human.
        if ((runErr as { code?: string } | null)?.code === '23505') {
            throw new BaselineRunConflictError(
                'Someone else is applying a baseline for this team and period. ' +
                'Reload before trying again.',
            );
        }
        throw runErr ?? new Error('The baseline run could not be recorded.');
    }

    const runId = String((run as { id: string }).id);
    const candidates = proposal.ledgers.flatMap(l => l.proposed);
    const skipped: ApplyRunResult['skipped'] = [];

    // ── Candidates already applied by an earlier run ─────────────────────────
    //
    // `idempotency_key` is globally unique and carries neither the run nor the
    // period, so a shift proposed from a Week view and again from a Month view
    // is one row. An already-APPLIED key is excluded rather than overwritten —
    // overwriting would discard the link to the shift that was really created.
    const keys = candidates.map(c => c.idempotencyKey);
    const appliedKeys = new Set<string>();
    if (keys.length > 0) {
        const { data: prior } = await supabase
            .from('baseline_ft_proposed_shifts')
            .select('idempotency_key, status')
            .in('idempotency_key', keys)
            .eq('status', 'applied');
        for (const row of (prior ?? []) as unknown as Array<Record<string, unknown>>) {
            appliedKeys.add(String(row.idempotency_key));
        }
    }

    const toWrite = candidates.filter(c => !appliedKeys.has(c.idempotencyKey));
    for (const c of candidates) {
        if (appliedKeys.has(c.idempotencyKey)) {
            skipped.push({
                idempotencyKey: c.idempotencyKey,
                reason: `A baseline shift for ${c.shiftDate} has already been created.`,
            });
        }
    }

    if (toWrite.length > 0) {
        const { error: rowsErr } = await supabase
            .from('baseline_ft_proposed_shifts')
            .upsert(toWrite.map(c => ({
                run_id: runId,
                employee_id: c.employeeId,
                user_contract_id: c.userContractId,
                source_slot_id: c.sourceSlotId,
                shift_date: c.shiftDate,
                start_time: c.startTime,
                end_time: c.endTime,
                unpaid_break_minutes: c.unpaidBreakMinutes,
                paid_break_minutes: c.paidBreakMinutes,
                net_minutes: c.netMinutes,
                role_id: c.roleId,
                target_employment_type: 'FT',
                idempotency_key: c.idempotencyKey,
                status: 'proposed',
                skip_reason: null,
                created_shift_id: null,
            })) as never, { onConflict: 'idempotency_key' });
        if (rowsErr) throw rowsErr;
    }

    // ── Re-read the world once, then create ──────────────────────────────────
    const employeeIds = [...new Set(toWrite.map(c => c.employeeId))];
    const [{ shiftsByEmployee }, { employees }] = await Promise.all([
        loadExistingShifts(employeeIds, proposal.periodStart, proposal.periodEnd),
        loadEligibleEmployees(subDepartmentId, proposal.periodStart, proposal.periodEnd),
    ]);
    const stillEligible = new Set(employees.map(e => e.facts.employeeId));

    // Days claimed within THIS apply, so two candidates for one person on one
    // day cannot both be written — the re-read cannot see a shift this loop
    // created a moment ago.
    const claimed = new Set<string>();
    let created = 0;

    const markSkipped = async (key: string, reason: string) => {
        skipped.push({ idempotencyKey: key, reason });
        await supabase.from('baseline_ft_proposed_shifts')
            .update({ status: 'skipped_conflict', skip_reason: reason })
            .eq('idempotency_key', key);
    };

    for (const c of toWrite) {
        const dayKey = `${c.employeeId}|${c.shiftDate}`;

        if (!stillEligible.has(c.employeeId)) {
            await markSkipped(c.idempotencyKey,
                'The employee is no longer a wholly full-time member of this team.');
            continue;
        }

        const existing = shiftsByEmployee.get(c.employeeId) ?? [];
        if (existing.some(s => s.date === c.shiftDate) || claimed.has(dayKey)) {
            await markSkipped(c.idempotencyKey,
                `A shift already exists for ${c.shiftDate}.`);
            continue;
        }

        let target: Awaited<ReturnType<typeof resolveTarget>>;
        try {
            target = await resolveTarget({
                subDepartmentId, departmentId, organizationId, shiftDate: c.shiftDate,
            });
        } catch (err) {
            await markSkipped(c.idempotencyKey,
                err instanceof Error ? err.message : `No draft roster covers ${c.shiftDate}.`);
            continue;
        }

        try {
            // The approved gateway. Runs the shape gate; never a raw insert.
            // `shift_subgroup_id` is the DTO's name for what the row stores as
            // `roster_subgroup_id`, which is NOT NULL.
            const createdShift = await shiftsCommands.createShift({
                roster_id: target.rosterId,
                shift_subgroup_id: target.rosterSubgroupId,
                organization_id: organizationId,
                department_id: departmentId,
                sub_department_id: subDepartmentId,
                shift_date: c.shiftDate,
                start_time: c.startTime,
                end_time: c.endTime,
                unpaid_break_minutes: c.unpaidBreakMinutes,
                paid_break_minutes: c.paidBreakMinutes,
                role_id: c.roleId,
                target_employment_type: 'FT',
                assigned_employee_id: c.employeeId,
                creation_source: 'baseline_ft',
                assignment_source: 'baseline_ft',
                // The Roster Planner buckets on these, NOT on
                // `roster_subgroup_id`. Omitting them writes a shift that is
                // correctly parented and renders in no group — which is what
                // made the first 39 invisible on /rosters.
                group_type: target.groupType as never,
                sub_group_name: target.subGroupName,
            });

            await supabase.from('baseline_ft_proposed_shifts')
                .update({ status: 'applied', created_shift_id: createdShift?.id ?? null })
                .eq('idempotency_key', c.idempotencyKey);

            if (createdShift?.id) {
                await supabase.from('shifts')
                    .update({ baseline_run_id: runId })
                    .eq('id', createdShift.id);
            }

            claimed.add(dayKey);
            created++;
        } catch (err) {
            // A compliance rejection at the gate is a legitimate outcome, not a
            // crash: the world changed and this candidate no longer fits.
            await markSkipped(c.idempotencyKey,
                err instanceof Error ? err.message : 'The shift could not be created.');
        }
    }

    const status: ApplyRunResult['status'] = skipped.length === 0 ? 'applied' : 'partially_applied';
    await supabase.from('baseline_ft_runs')
        .update({
            status,
            applied_at: new Date().toISOString(),
            applied_by: actorId,
            applied_count: created,
            skipped_count: skipped.length,
        })
        .eq('id', runId);

    return { runId, created, skipped, status };
}
