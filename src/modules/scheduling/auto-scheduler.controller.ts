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

import { optimizerClient, OptimizerError } from './optimizer/optimizer.client';
import { solutionParser } from './optimizer/solution-parser';
import { bulkAssignmentController } from '@/modules/rosters/bulk-assignment';
import { supabase } from '@/platform/realtime/client';
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import type { ExistingShiftRef } from './types';
import type {
    OptimizeRequest,
    OptimizerEmployee,
    OptimizerShift,
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerConstraints,
    OptimizerHealth,
    OptimizerStatus,
    UncoveredAudit,
    CapacityCheck,
    CapacityDayBreakdown,
} from './types';

// Hard cap on per-shift audit detail. Each audited shift gets per-employee
// rejection rows; capping keeps the UI/CSV manageable when the deficit is huge.
const MAX_AUDITED_SHIFTS = 50;

// Default per-employee daily working-minute cap used by the capacity pre-check
// when employee.max_daily_minutes is not supplied. 8h = 480m.
const DEFAULT_MAX_DAILY_MINUTES = 480;

// Mirrors the Python service guards (ortools_runner.py). Surface to the user
// before we serialize a giant payload and round-trip to the optimizer.
export const MAX_OPTIMIZER_SHIFTS = 500;
export const MAX_OPTIMIZER_EMPLOYEES = 200;

export class AutoSchedulerInputTooLargeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AutoSchedulerInputTooLargeError';
    }
}
import type { BulkAssignmentResult } from '@/modules/rosters/bulk-assignment';

// =============================================================================
// INPUT / OPTIONS
// =============================================================================

export interface AutoSchedulerInput {
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    employeeDetails?: Map<string, Partial<OptimizerEmployee>>;
    constraints?: OptimizerConstraints;
    timeLimitSeconds?: number;
    numWorkers?: number;
    /** Allows the caller to abort an in-flight run before it overwrites state. */
    signal?: AbortSignal;
}

export interface CommitResult {
    success: boolean;
    totalCommitted: number;
    failedEmployees: string[];
    concurrencyConflicts: string[];   // Shift IDs that failed the recheck
}

// =============================================================================
// FALLBACK: Greedy Incremental Assignment
// =============================================================================

/**
 * When OR-Tools is unavailable or returns INFEASIBLE, fall back to a greedy
 * first-fit strategy: iterate employees in load-ascending order, assign each
 * unfilled shift to the first employee that passes compliance simulation.
 *
 * This guarantees the user always gets a usable result.
 */
async function greedyFallback(
    shifts: ShiftMeta[],
    employees: EmployeeMeta[],
): Promise<ValidatedProposal[]> {
    const proposals: ValidatedProposal[] = [];
    const assignedByEmployee = new Map<string, string[]>();

    for (const emp of employees) {
        assignedByEmployee.set(emp.id, []);
    }

    for (const shift of shifts) {
        let assigned = false;

        // Try employees in order of current load (ascending) for fairness
        const sorted = [...employees].sort(
            (a, b) => (assignedByEmployee.get(a.id)?.length ?? 0) - (assignedByEmployee.get(b.id)?.length ?? 0),
        );

        for (const emp of sorted) {
            const existingShiftIds = assignedByEmployee.get(emp.id) ?? [];
            const candidateIds = [...existingShiftIds, shift.id];

            try {
                const simResult = await bulkAssignmentController.simulate(
                    candidateIds,
                    emp.id,
                    { mode: 'PARTIAL_APPLY' },
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
                        optimizerScore: 0.5,
                        complianceStatus: 'PASS',
                        violations: [],
                        passing: true,
                    });
                    assigned = true;
                    break;
                }
            } catch {
                // Skip this employee on error
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
                optimizerScore: 0,
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
        const existingRoster = await this._fetchExistingRoster(
            input.shifts, input.employees,
        );
        throwIfAborted();
        const totalExisting = Array.from(existingRoster.values())
            .reduce((acc, list) => acc + list.length, 0);
        if (totalExisting > 0) {
            console.debug(
                '[AutoScheduler] Roster context: %d existing shifts across %d employees',
                totalExisting, existingRoster.size,
            );
        }

        // ── Layer 1: Build optimizer request ─────────────────────────────────
        const optimizerShifts: OptimizerShift[] = input.shifts.map(s => ({
            id: s.id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            duration_minutes: this._durationMinutes(s.start_time, s.end_time),
            role_id: s.role_id,
            priority: 1,
        }));

        const optimizerEmployees: OptimizerEmployee[] = input.employees.map(e => ({
            id: e.id,
            name: e.name,
            max_weekly_minutes: 2400,
            ...(input.employeeDetails?.get(e.id) ?? {}),
            existing_shifts: existingRoster.get(e.id) ?? [],
        }));

        let optimizerStatus: OptimizerStatus = 'UNKNOWN';
        let solveTimeMs = 0;
        let validationTimeMs = 0;
        let uncoveredShiftIds: string[] = [];
        let validatedProposals: ValidatedProposal[] = [];
        let usedFallback = false;

        // ── Layer 2: Call optimizer (with fallback) ───────────────────────────
        try {
            const optimizeReq: OptimizeRequest = {
                shifts: optimizerShifts,
                employees: optimizerEmployees,
                constraints: input.constraints ?? { min_rest_minutes: 600 },
                time_limit_seconds: input.timeLimitSeconds ?? 30,
            };

            const optimizeResponse = await optimizerClient.optimize(optimizeReq, input.signal);
            throwIfAborted();
            optimizerStatus = optimizeResponse.status;
            solveTimeMs = optimizeResponse.solve_time_ms;

            if (optimizerStatus === 'INFEASIBLE' || optimizerStatus === 'UNKNOWN' || optimizerStatus === 'MODEL_INVALID') {
                // Optimizer cannot find a solution → fall back to greedy
                console.warn('[AutoScheduler] Optimizer returned %s — falling back to greedy engine', optimizerStatus);
                usedFallback = true;
                const validationStart = performance.now();
                validatedProposals = await greedyFallback(input.shifts, input.employees);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                // ── Parse + compliance validate ───────────────────────────────
                const { shiftMap, employeeMap } = solutionParser.buildMaps(input.shifts, input.employees);
                const { groups, uncoveredShiftIds: uncov } = solutionParser.parse(optimizeResponse, shiftMap, employeeMap);
                uncoveredShiftIds = uncov;

                const validationStart = performance.now();
                validatedProposals = await this._validateProposals(groups);
                validationTimeMs = Math.round(performance.now() - validationStart);
                console.debug('[AutoScheduler] Compliance validation: %dms', validationTimeMs);
            }
        } catch (err) {
            if (err instanceof OptimizerError && err.code === 'CONNECTION_REFUSED') {
                console.warn('[AutoScheduler] Optimizer offline — falling back to greedy engine');
                usedFallback = true;
                optimizerStatus = 'UNKNOWN';
                const validationStart = performance.now();
                validatedProposals = await greedyFallback(input.shifts, input.employees);
                validationTimeMs = Math.round(performance.now() - validationStart);
                uncoveredShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                throw err;
            }
        }
        throwIfAborted();

        const passing = validatedProposals.filter(p => p.passing).length;
        const failing = validatedProposals.length - passing;

        const result: AutoSchedulerResult = {
            optimizerStatus,
            solveTimeMs,
            validationTimeMs,
            totalProposals: validatedProposals.length,
            passing,
            failing,
            uncoveredShiftIds,
            proposals: validatedProposals,
            canCommit: passing > 0,
            usedFallback,
            capacityCheck,
        };

        // ── Layer 3: Audit uncovered shifts (the "Why") ───────────────────────
        if (result.uncoveredShiftIds.length > 0) {
            throwIfAborted();
            const auditStart = performance.now();
            result.uncoveredAudit = await this._auditUncoveredShifts(
                result.uncoveredShiftIds,
                input.shifts,
                input.employees,
                result.proposals,
                capacityCheck,
            );
            result.auditedUncoveredCount = result.uncoveredAudit.length;
            console.debug('[AutoScheduler] Audit complete: %dms', Math.round(performance.now() - auditStart));
        }

        console.debug('[AutoScheduler] Preview ready:', {
            status: optimizerStatus, passing, failing,
            uncovered: uncoveredShiftIds.length, fallback: usedFallback,
            totalMs: Math.round(performance.now() - t0),
        });

        return result;
    }

    /**
     * Commit passing proposals with concurrency recheck.
     *
     * CRITICAL: Re-runs simulate() with fresh DB state per employee group
     * before calling commit(). Catches races where another user assigned
     * one of the target shifts between preview and confirm.
     */
    async commit(result: AutoSchedulerResult): Promise<CommitResult> {
        const byEmployee = new Map<string, string[]>();
        for (const p of result.proposals) {
            if (!p.passing || !p.employeeId) continue;
            const list = byEmployee.get(p.employeeId) ?? [];
            list.push(p.shiftId);
            byEmployee.set(p.employeeId, list);
        }

        // ── Per-employee commits run in parallel ─────────────────────────────
        // Each employee's recheck + sm_bulk_assign is independent — no shared
        // employee state — so there is no reason to serialize.
        type EmpOutcome = { employeeId: string; committed: number; failed: boolean; conflicts: string[] };
        const outcomes: EmpOutcome[] = await Promise.all(
            Array.from(byEmployee.entries()).map(async ([employeeId, shiftIds]): Promise<EmpOutcome> => {
                let freshResult: BulkAssignmentResult;
                try {
                    freshResult = await bulkAssignmentController.simulate(
                        shiftIds, employeeId, { mode: 'PARTIAL_APPLY' },
                    );
                } catch (err) {
                    console.error('[AutoScheduler] Recheck failed for employee', employeeId, err);
                    return { employeeId, committed: 0, failed: true, conflicts: [] };
                }

                const nowFailing = freshResult.failedShiftIds;
                if (freshResult.passedShiftIds.length === 0) {
                    console.warn('[AutoScheduler] All shifts failed recheck for', employeeId);
                    return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                }

                try {
                    const commitResult = await bulkAssignmentController.commit(freshResult, employeeId);
                    if (commitResult.success) {
                        if (nowFailing.length > 0) {
                            console.warn('[AutoScheduler] Concurrency: skipped %d shifts for %s', nowFailing.length, employeeId);
                        }
                        return { employeeId, committed: commitResult.committed.length, failed: false, conflicts: nowFailing };
                    }
                    return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                } catch (err) {
                    console.error('[AutoScheduler] Commit error for', employeeId, err);
                    return { employeeId, committed: 0, failed: true, conflicts: nowFailing };
                }
            }),
        );

        const totalCommitted = outcomes.reduce((acc, o) => acc + o.committed, 0);
        const failedEmployees = outcomes.filter(o => o.failed).map(o => o.employeeId);
        const concurrencyConflicts = outcomes.flatMap(o => o.conflicts);

        console.debug('[AutoScheduler] Commit complete:', { totalCommitted, failedEmployees, concurrencyConflicts });

        return {
            success: failedEmployees.length === 0 && concurrencyConflicts.length === 0,
            totalCommitted,
            failedEmployees,
            concurrencyConflicts,
        };
    }

    async checkHealth(): Promise<OptimizerHealth> {
        return optimizerClient.healthCheck();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Fetch each candidate employee's already-committed shifts within (and
     * just outside) the optimization window. The window is widened by one day
     * on each side so shifts adjacent to the window can still anchor rest-gap
     * checks (e.g. a Sunday-night shift constrains a Monday-morning proposal).
     *
     * Uses the SECURITY DEFINER RPC `get_employee_shift_window` so cross-
     * department shifts remain visible regardless of the calling manager's
     * RLS scope — the same correctness reasoning the bulk-assignment scenario
     * loader uses. A direct `.from('shifts')` query is RLS-scoped and can
     * silently omit shifts in other departments, producing false-pass
     * proposals that would later be rejected by compliance.
     */
    private async _fetchExistingRoster(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, ExistingShiftRef[]>> {
        const result = new Map<string, ExistingShiftRef[]>();
        if (shifts.length === 0 || employees.length === 0) return result;

        const dates = shifts.map(s => s.shift_date).sort();
        const windowStart = this._shiftDate(dates[0], -1);
        const windowEnd = this._shiftDate(dates[dates.length - 1], +1);
        const candidateShiftIds = new Set(shifts.map(s => s.id));

        await Promise.all(employees.map(async emp => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase.rpc as any)('get_employee_shift_window', {
                    p_employee_id: emp.id,
                    p_start_date: windowStart,
                    p_end_date: windowEnd,
                    p_exclude_id: null,
                });
                if (error) {
                    console.warn('[AutoScheduler] Roster fetch failed for', emp.id, error);
                    result.set(emp.id, []);
                    return;
                }
                const rows = (data ?? []) as Array<{
                    id: string;
                    shift_date: string;
                    start_time: string;
                    end_time: string;
                }>;
                // Drop the candidate shifts themselves — they're what we're
                // about to assign, not pre-existing constraints.
                const refs: ExistingShiftRef[] = rows
                    .filter(r => !candidateShiftIds.has(r.id))
                    .map(r => ({
                        id: r.id,
                        shift_date: r.shift_date,
                        start_time: this._normalizeTime(r.start_time),
                        end_time: this._normalizeTime(r.end_time),
                        duration_minutes: this._durationMinutes(
                            this._normalizeTime(r.start_time),
                            this._normalizeTime(r.end_time),
                        ),
                    }));
                result.set(emp.id, refs);
            } catch (err) {
                console.warn('[AutoScheduler] Roster fetch threw for', emp.id, err);
                result.set(emp.id, []);
            }
        }));

        return result;
    }

    /** Add or subtract calendar days from YYYY-MM-DD without timezone drift. */
    private _shiftDate(date: string, offsetDays: number): string {
        const [y, m, d] = date.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + offsetDays);
        const yy = dt.getUTCFullYear();
        const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(dt.getUTCDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
    }

    /** Postgres returns 'HH:MM:SS' for time columns; the optimizer expects 'HH:MM'. */
    private _normalizeTime(t: string): string {
        if (!t) return t;
        const parts = t.split(':');
        return `${parts[0]}:${parts[1]}`;
    }

    /**
     * For each uncovered shift, explain why each employee was rejected.
     */
    private async _auditUncoveredShifts(
        uncoveredIds: string[],
        allShifts: ShiftMeta[],
        allEmployees: EmployeeMeta[],
        proposals: ValidatedProposal[],
        capacityCheck?: CapacityCheck,
    ): Promise<UncoveredAudit[]> {
        const shiftMap = new Map(allShifts.map(s => [s.id, s]));

        // Cap audited shifts so the rendered/exported detail stays bounded.
        const targetIds = uncoveredIds.slice(0, MAX_AUDITED_SHIFTS);

        // Days that the pre-check flagged as mathematically under-capacity.
        const deficitDays = new Set(capacityCheck?.deficitDays.map(d => d.date) ?? []);

        // ── One simulate() per employee, batched over all audited shifts ─────
        // Previously this was simulate(1 shift) × employees × shifts =
        // O(S·E) sequential RPC calls. The batched form is O(E) — for a
        // typical 50-shift × 20-employee audit that's 1000 → 20 round-trips.
        type ShiftSimRow = {
            status: 'PASS' | 'WARN' | 'FAIL';
            violations: Array<{ violation_type: string; description: string; blocking?: boolean }>;
            passing: boolean;
        };
        type EmpSim = { emp: EmployeeMeta; resultByShift: Map<string, ShiftSimRow> };
        const empSims: EmpSim[] = await Promise.all(allEmployees.map(async (emp): Promise<EmpSim> => {
            try {
                const sim = await bulkAssignmentController.simulate(
                    targetIds, emp.id, { mode: 'PARTIAL_APPLY' },
                );
                const map = new Map<string, ShiftSimRow>();
                for (const r of sim.results) {
                    map.set(r.shiftId, { status: r.status, violations: r.violations, passing: r.passing });
                }
                return { emp, resultByShift: map };
            } catch {
                return { emp, resultByShift: new Map() };
            }
        }));

        // ── Reassemble per-shift audits from the per-employee results ────────
        const audits: UncoveredAudit[] = [];
        for (const shiftId of targetIds) {
            const s = shiftMap.get(shiftId);
            if (!s) continue;

            const summary: Record<string, number> = {};
            const details: UncoveredAudit['employeeDetails'] = [];
            let allEmployeesPass = true;

            for (const { emp, resultByShift } of empSims) {
                const res = resultByShift.get(shiftId);
                if (!res) continue;

                // Optimizer already placed this employee on a conflicting shift
                // at the same time — flag separately so the audit reflects the
                // result-level conflict, not just incremental compliance.
                const overlapProposal = proposals.find(p =>
                    p.employeeId === emp.id &&
                    p.shiftDate === s.shift_date &&
                    this._shiftsOverlap(
                        { startTime: s.start_time, endTime: s.end_time },
                        p,
                    )
                );

                let status: 'PASS' | 'WARN' | 'FAIL' = res.status;
                const violations: Array<{ type: string; description: string }> =
                    res.violations.map(v => ({ type: v.violation_type, description: v.description }));

                if (overlapProposal) {
                    status = 'FAIL';
                    violations.push({
                        type: 'CAPACITY_CONFLICT',
                        description: `Employee assigned to another shift at this time (${overlapProposal.startTime}–${overlapProposal.endTime}).`
                    });
                    summary['CAPACITY_CONFLICT'] = (summary['CAPACITY_CONFLICT'] ?? 0) + 1;
                    allEmployeesPass = false;
                } else if (!res.passing) {
                    for (const v of res.violations) {
                        summary[v.violation_type] = (summary[v.violation_type] ?? 0) + 1;
                    }
                    allEmployeesPass = false;
                }

                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    status: status as any,
                    violations,
                });
            }

            // Capacity-bound case: every employee individually passes compliance
            // for this shift, yet the shift is still uncovered. The cause is
            // not eligibility — it's that there are not enough people-hours
            // available on this day to cover every shift.
            if (allEmployeesPass && details.length > 0) {
                const reason = deficitDays.has(s.shift_date)
                    ? 'INSUFFICIENT_CAPACITY'
                    : 'OPTIMIZER_TRADEOFF';
                summary[reason] = (summary[reason] ?? 0) + 1;
            }

            audits.push({
                shiftId,
                shiftDate: s.shift_date,
                startTime: s.start_time,
                endTime: s.end_time,
                rejectionSummary: summary,
                employeeDetails: details,
            });
        }

        return audits;
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

        // Aggregate demand by day
        const demandByDate = new Map<string, { minutes: number; count: number }>();
        for (const s of shifts) {
            const mins = this._durationMinutes(s.start_time, s.end_time);
            const cur = demandByDate.get(s.shift_date) ?? { minutes: 0, count: 0 };
            cur.minutes += mins;
            cur.count += 1;
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
            const deficit = Math.max(0, demand.minutes - supplyPerDay);
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

    private async _validateProposals(
        groups: ReturnType<typeof solutionParser.parse>['groups'],
    ): Promise<ValidatedProposal[]> {
        const all: ValidatedProposal[] = [];

        for (const group of groups) {
            let bulkResult: BulkAssignmentResult;
            try {
                bulkResult = await bulkAssignmentController.simulate(
                    group.shiftIds, group.employeeId, { mode: 'PARTIAL_APPLY' },
                );
            } catch (err) {
                for (const p of group.proposals) {
                    all.push({
                        shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                        shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                        optimizerScore: p.score, complianceStatus: 'FAIL',
                        violations: [{ type: 'SYSTEM', description: 'Compliance check error', blocking: true }],
                        passing: false,
                    });
                }
                continue;
            }

            const resultByShift = new Map(bulkResult.results.map(r => [r.shiftId, r]));
            for (const p of group.proposals) {
                const cr = resultByShift.get(p.shiftId);
                all.push({
                    shiftId: p.shiftId, employeeId: p.employeeId, employeeName: p.employeeName,
                    shiftDate: p.shiftDate, startTime: p.startTime, endTime: p.endTime,
                    optimizerScore: p.score,
                    complianceStatus: cr?.status === 'PASS' ? 'PASS' : cr?.status === 'WARN' ? 'WARN' : 'FAIL',
                    violations: (cr?.violations ?? []).map(v => ({
                        type: v.violation_type, description: v.description, blocking: v.blocking,
                    })),
                    passing: cr?.passing ?? false,
                });
            }
        }

        return all;
    }

    private _durationMinutes(start: string, end: string): number {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let mins = eh * 60 + em - (sh * 60 + sm);
        if (mins <= 0) mins += 1440;
        return mins;
    }

    private _shiftsOverlap(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
        const aStart = this._timeToMins(a.startTime);
        const aEnd = this._timeToMins(a.endTime);
        const bStart = this._timeToMins(b.startTime);
        const bEnd = this._timeToMins(b.endTime);
        return aStart < bEnd && bStart < aEnd;
    }

    private _timeToMins(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }
}

export const autoSchedulerController = new AutoSchedulerController();
