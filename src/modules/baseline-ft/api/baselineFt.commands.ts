/**
 * Baseline FT — Generate and Apply.
 *
 * Generate is READ-ONLY with respect to `shifts`. It reads the world, runs the
 * pure domain pipeline, and persists a proposal. Apply is the ONLY write, and
 * it revalidates everything rather than trusting what Generate stored, because
 * the roster can move between the two.
 *
 * A BLOCKING finding drops ONE CANDIDATE, not the run. One employee's rest
 * conflict must not discard twenty other people's valid shifts. The single
 * exception is a pattern-level failure, which aborts wholesale — the pattern is
 * common to everyone in the sub-department, so if it is unlawful there is
 * nothing lawful to generate for anybody.
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
import { computeCycleRequirements } from '../domain/requirementCalculator';
import { generateCandidates, type RunScope } from '../domain/candidateGenerator';
import { admitCandidates } from '../domain/admissionEngine';
import { hasBlocking, type Candidate, type CycleRequirement, type Finding, type IsoWeekday } from '../domain/types';

import {
    loadEligibleEmployees,
    loadExistingShifts,
    loadLeaveDays,
    loadPattern,
    loadPublicHolidays,
} from './baselineFt.loaders';
import { inputDigest, snapshotVersion } from './digest';


/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

export interface GenerateRunInput {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    templateId: string;
    /** Inclusive, `yyyy-MM-dd`. */
    periodStart: string;
    periodEnd: string;
    /** Reference date for rule evaluation. Passed in so runs are reproducible. */
    referenceDate: string;
    actorId: string;
}

/** One employee's ledger, as the review screen reads it. */
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
}

export interface BaselineProposal {
    scope: RunScope & { organizationId: string; departmentId: string };
    periodStart: string;
    periodEnd: string;
    referenceDate: string;
    generatedAt: string;
    /** Stated on every run: `is_ordinary_hours` is not a stored fact. */
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
    };
}

export interface GenerateRunResult {
    runId: string | null;
    proposal: BaselineProposal;
    /** Present when the pattern is unlawful and nothing was generated. */
    aborted: boolean;
}

export class BaselineRunConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BaselineRunConflictError';
    }
}

/* ────────────────────────────────────────────────────────────────────────────
   Generate
   ──────────────────────────────────────────────────────────────────────────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Widen a date window to cover the WHOLE cycles it touches.
 *
 * Consumption must be counted over complete cycles: hours worked earlier in a
 * cycle fill the same ceiling as hours inside the roster period, so reading
 * only the period would understate what the employee has already done and
 * over-roster them. Uses the widest cycle length in play, which is the safe
 * direction — reading extra days can only ever make the count more complete.
 */
function widenToCycles(
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

export async function generateBaselineRun(input: GenerateRunInput): Promise<GenerateRunResult> {
    const {
        organizationId, departmentId, subDepartmentId, templateId,
        periodStart, periodEnd, referenceDate, actorId,
    } = input;

    const runFindings: Finding[] = [];

    // ── 1. Pattern ───────────────────────────────────────────────────────────
    const { pattern, findings: patternFindings, rawSlots } = await loadPattern(templateId);
    runFindings.push(...patternFindings);

    const scope: RunScope = { subDepartmentId, periodStart, periodEnd, templateId };
    const emptyProposal = (): BaselineProposal => ({
        scope: { ...scope, organizationId, departmentId },
        periodStart, periodEnd, referenceDate,
        generatedAt: new Date().toISOString(),
        axioms: AXIOMS,
        ledgers: [],
        runFindings,
        totals: {
            employees: 0, requiredHours: 0, existingHours: 0, leaveHours: 0,
            proposedHours: 0, varianceHours: 0, proposedShiftCount: 0,
        },
    });

    if (!pattern || hasBlocking(runFindings)) {
        return { runId: null, proposal: emptyProposal(), aborted: true };
    }

    if (pattern.subDepartmentId !== subDepartmentId) {
        runFindings.push({
            severity: 'BLOCKING',
            code: 'BFT_TEMPLATE_WRONG_SUB_DEPARTMENT',
            plain: 'That template belongs to a different sub-department.',
            overridable: false,
            calculation: { template_sub_department: pattern.subDepartmentId, requested: subDepartmentId },
        });
        return { runId: null, proposal: emptyProposal(), aborted: true };
    }

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

    // ── 2. Eligible employees ────────────────────────────────────────────────
    const { employees, findings: eligibilityFindings, rawContracts } =
        await loadEligibleEmployees(subDepartmentId, periodStart, periodEnd);
    runFindings.push(...eligibilityFindings);

    if (employees.length === 0) {
        runFindings.push({
            severity: 'INFO',
            code: 'BFT_NO_ELIGIBLE_EMPLOYEES',
            plain: 'No wholly full-time employees are contracted to this sub-department for this period.',
            overridable: false,
        });
        return { runId: null, proposal: emptyProposal(), aborted: false };
    }

    // ── 3. Pattern vs contract, per distinct contract shape ──────────────────
    //
    // Validated against every DISTINCT (weekly hours, cycle, role) the team
    // holds, because a pattern lawful for a 38h contract may breach a 20h one.
    const seen = new Set<string>();
    for (const e of employees) {
        const key = `${e.facts.contractedWeeklyHours}|${e.facts.cycleWeeks}|${e.facts.roleId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        runFindings.push(...validatePattern(pattern, e.facts).map(f => ({
            ...f,
            employeeId: f.employeeId ?? e.facts.employeeId,
        })));
    }
    if (hasBlocking(runFindings)) {
        return { runId: null, proposal: emptyProposal(), aborted: true };
    }

    // ── 4. The world ─────────────────────────────────────────────────────────
    const patternHoursByWeekday = new Map<IsoWeekday, number>();
    for (const slot of pattern.slots) {
        patternHoursByWeekday.set(
            slot.dayOfWeek,
            (patternHoursByWeekday.get(slot.dayOfWeek) ?? 0) + slot.netMinutes / 60,
        );
    }

    const employeeIds = employees.map(e => e.facts.employeeId);
    const window = widenToCycles(periodStart, periodEnd,
        employees.map(e => ({ anchor: e.facts.cycleAnchor, weeks: e.facts.cycleWeeks })));

    const [{ shiftsByEmployee, snapshotRefs }, leaveByEmployee, publicHolidays] = await Promise.all([
        loadExistingShifts(employeeIds, window.from, window.to),
        loadLeaveDays(employeeIds, window.from, window.to, patternHoursByWeekday),
        loadPublicHolidays(window.from, window.to),
    ]);

    const snapshot = snapshotVersion(snapshotRefs);

    // ── 5. The pure pipeline, per employee ───────────────────────────────────
    const ledgers: EmployeeLedger[] = [];

    for (const e of employees) {
        const existing = shiftsByEmployee.get(e.facts.employeeId) ?? [];
        const leaveDays = leaveByEmployee.get(e.facts.employeeId) ?? [];

        const { cycles, findings: reqFindings } = computeCycleRequirements({
            facts: e.facts,
            periodStart, periodEnd,
            existingShifts: existing,
            leaveDays,
            publicHolidays,
            patternHoursByWeekday,
        });

        const { candidates, findings: genFindings } = generateCandidates({
            facts: e.facts, pattern, cycles,
            existingShifts: existing,
            periodStart, periodEnd, scope,
        });

        const v8Employee: V8Employee = {
            id: e.facts.employeeId,
            name: e.name,
            contract_type: 'FULL_TIME',
            contracted_weekly_hours: e.facts.contractedWeeklyHours ?? 38,
            ordinary_hours_cycle_weeks: e.facts.cycleWeeks,
            ordinary_hours_cycle_anchor: e.facts.cycleAnchor,
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
            employeeId: e.facts.employeeId,
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
            findings: [...reqFindings, ...genFindings, ...warnings],
        });
    }

    const totals = ledgers.reduce((t, l) => ({
        employees: t.employees + 1,
        requiredHours: round1(t.requiredHours + l.requiredHours),
        existingHours: round1(t.existingHours + l.existingHours),
        leaveHours: round1(t.leaveHours + l.leaveHours),
        proposedHours: round1(t.proposedHours + l.proposedHours),
        varianceHours: round1(t.varianceHours + l.varianceHours),
        proposedShiftCount: t.proposedShiftCount + l.proposed.length,
    }), {
        employees: 0, requiredHours: 0, existingHours: 0, leaveHours: 0,
        proposedHours: 0, varianceHours: 0, proposedShiftCount: 0,
    });

    const proposal: BaselineProposal = {
        scope: { ...scope, organizationId, departmentId },
        periodStart, periodEnd, referenceDate,
        generatedAt: new Date().toISOString(),
        axioms: AXIOMS,
        ledgers,
        runFindings,
        totals,
    };

    // ── 6. Persist. Still nothing written to `shifts`. ───────────────────────
    const digest = inputDigest({
        subDepartmentId, periodStart, periodEnd, templateId,
        patternSlots: rawSlots,
        employees: rawContracts,
        snapshotVersion: snapshot,
        config: { enforce_ft_days_off: true, min_rest_gap_minutes: 600, referenceDate },
    });

    const { data: run, error } = await supabase
        .from('baseline_ft_runs')
        .insert({
            organization_id: organizationId,
            department_id: departmentId,
            sub_department_id: subDepartmentId,
            template_id: templateId,
            period_start: periodStart,
            period_end: periodEnd,
            snapshot_version: snapshot,
            input_digest: digest,
            proposal: proposal as unknown as Json,
            status: 'generated',
            created_by: actorId,
        })
        .select('id')
        .single();

    if (error) {
        // 23505 — the partial unique index fired. Another manager already has a
        // live proposal for this exact scope. A deterministic conflict, which
        // is the point: two rival proposals over the same dates would have to
        // be reconciled by a human.
        if ((error as { code?: string }).code === '23505') {
            throw new BaselineRunConflictError(
                'Someone else has already generated a baseline for this team and period. ' +
                'Open or discard that proposal before generating another.',
            );
        }
        throw error;
    }

    const runId = String((run as { id: string }).id);

    const rows = ledgers.flatMap(l => l.proposed.map(c => ({
        run_id: runId,
        employee_id: c.employeeId,
        user_contract_id: c.userContractId,
        template_shift_id: c.templateShiftId,
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
    })));

    if (rows.length > 0) {
        const { error: rowsErr } = await supabase
            .from('baseline_ft_proposed_shifts')
            .insert(rows);
        if (rowsErr) throw rowsErr;
    }

    return { runId, proposal, aborted: false };
}

/**
 * Stated on every run, so nobody has to infer it from the numbers.
 *
 * `shifts.is_ordinary_hours` is not a column — it is a TypeScript literal at
 * every call site in the codebase — so the ordinary/overtime split cannot be
 * read from the roster. Until it can, every rostered hour counts as ordinary,
 * and saying so is the difference between a stated assumption and a hidden one.
 */
const AXIOMS: string[] = [
    'All existing rostered hours are counted as ordinary hours. The system does not ' +
    'currently record whether a shift was worked as ordinary time or overtime.',
];

/* ────────────────────────────────────────────────────────────────────────────
   Apply
   ──────────────────────────────────────────────────────────────────────────── */

export interface ApplyRunResult {
    runId: string;
    created: number;
    skipped: Array<{ idempotencyKey: string; reason: string }>;
    status: 'applied' | 'partially_applied';
}

/**
 * Create the proposed shifts as DRAFTS.
 *
 * Everything is re-read. Nothing Generate stored is trusted, because the roster
 * can move in between — and a candidate that has become invalid is DROPPED with
 * a reason rather than forced through or allowed to abort its twenty innocent
 * neighbours.
 *
 * Writes go through `shiftsCommands.createShift`, never a raw insert, so the
 * shift-shape gate runs on the way past exactly as it does for every other
 * creation path in the product.
 */
export async function applyBaselineRun(
    runId: string,
    actorId: string,
    rosterSubgroupResolver: (args: {
        subDepartmentId: string; departmentId: string; organizationId: string; shiftDate: string;
    }) => Promise<{ rosterId: string; rosterSubgroupId: string }>,
): Promise<ApplyRunResult> {
    const { data: run, error: runErr } = await supabase
        .from('baseline_ft_runs')
        .select('id, organization_id, department_id, sub_department_id, period_start, period_end, status, snapshot_version')
        .eq('id', runId)
        .single();

    if (runErr || !run) throw runErr ?? new Error('Baseline run not found.');
    if ((run as { status: string }).status !== 'generated') {
        throw new BaselineRunConflictError(
            'This proposal has already been applied or discarded.',
        );
    }

    const r = run as unknown as {
        organization_id: string; department_id: string; sub_department_id: string;
        period_start: string; period_end: string; snapshot_version: string;
    };

    const { data: proposed, error: propErr } = await supabase
        .from('baseline_ft_proposed_shifts')
        .select('id, employee_id, user_contract_id, shift_date, start_time, end_time, ' +
                'unpaid_break_minutes, paid_break_minutes, net_minutes, role_id, ' +
                'idempotency_key, status')
        .eq('run_id', runId)
        .eq('status', 'proposed')
        .order('shift_date', { ascending: true })
        .order('idempotency_key', { ascending: true });

    if (propErr) throw propErr;

    const rows = (proposed ?? []) as unknown as Array<Record<string, unknown>>;
    const skipped: ApplyRunResult['skipped'] = [];
    let created = 0;

    // Re-read the world ONCE for the whole apply, rather than per candidate.
    const employeeIds = [...new Set(rows.map(x => String(x.employee_id)))];
    const [{ shiftsByEmployee }, { employees }] = await Promise.all([
        loadExistingShifts(employeeIds, r.period_start, r.period_end),
        loadEligibleEmployees(r.sub_department_id, r.period_start, r.period_end),
    ]);
    const stillEligible = new Set(employees.map(e => e.facts.employeeId));

    for (const row of rows) {
        const key = String(row.idempotency_key);
        const employeeId = String(row.employee_id);
        const shiftDate = String(row.shift_date);

        const skip = async (reason: string) => {
            skipped.push({ idempotencyKey: key, reason });
            await supabase.from('baseline_ft_proposed_shifts')
                .update({ status: 'skipped_conflict', skip_reason: reason })
                .eq('id', String(row.id));
        };

        // Contract ended, employee moved, or they are no longer wholly FT.
        if (!stillEligible.has(employeeId)) {
            await skip('The employee is no longer a wholly full-time member of this team.');
            continue;
        }

        const existing = shiftsByEmployee.get(employeeId) ?? [];
        if (existing.some(s => s.date === shiftDate)) {
            await skip(`A shift was created for ${shiftDate} after this proposal was generated.`);
            continue;
        }

        let target: { rosterId: string; rosterSubgroupId: string };
        try {
            target = await rosterSubgroupResolver({
                subDepartmentId: r.sub_department_id,
                departmentId: r.department_id,
                organizationId: r.organization_id,
                shiftDate,
            });
        } catch (err) {
            await skip(
                err instanceof Error
                    ? err.message
                    : `No draft roster is available for ${shiftDate}.`,
            );
            continue;
        }

        try {
            // The approved gateway. Runs the shape gate; never a raw insert.
            // `shift_subgroup_id` is the DTO's name for what the row stores as
            // `roster_subgroup_id`, which is NOT NULL — so every proposed shift
            // needs a resolved subgroup before it can be written.
            const createdShift = await shiftsCommands.createShift({
                roster_id: target.rosterId,
                shift_subgroup_id: target.rosterSubgroupId,
                organization_id: r.organization_id,
                department_id: r.department_id,
                sub_department_id: r.sub_department_id,
                shift_date: shiftDate,
                start_time: String(row.start_time),
                end_time: String(row.end_time),
                unpaid_break_minutes: Number(row.unpaid_break_minutes ?? 0),
                paid_break_minutes: Number(row.paid_break_minutes ?? 0),
                role_id: String(row.role_id),
                target_employment_type: 'FT',
                assigned_employee_id: employeeId,
                creation_source: 'baseline_ft',
                assignment_source: 'baseline_ft',
            });

            await supabase.from('baseline_ft_proposed_shifts')
                .update({ status: 'applied', created_shift_id: createdShift?.id ?? null })
                .eq('id', String(row.id));

            if (createdShift?.id) {
                await supabase.from('shifts')
                    .update({ baseline_run_id: runId })
                    .eq('id', createdShift.id);
            }

            created++;
        } catch (err) {
            // A compliance rejection at the gate is a legitimate outcome, not a
            // crash: the world changed and this candidate no longer fits.
            await skip(err instanceof Error ? err.message : 'The shift could not be created.');
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
