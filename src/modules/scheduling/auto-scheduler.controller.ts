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
import type { ShiftMeta, EmployeeMeta } from './optimizer/solution-parser';
import type {
    OptimizeRequest,
    OptimizerEmployee,
    OptimizerShift,
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerConstraints,
    OptimizerHealth,
    OptimizerStatus,
} from './types';
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
        const t0 = performance.now();
        console.debug('[AutoScheduler] Starting — shifts=%d employees=%d', input.shifts.length, input.employees.length);

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
        }));

        let optimizerStatus: OptimizerStatus = 'UNKNOWN';
        let solveTimeMs = 0;
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

            const optimizeResponse = await optimizerClient.optimize(optimizeReq);
            optimizerStatus = optimizeResponse.status;
            solveTimeMs = optimizeResponse.solve_time_ms;

            if (optimizerStatus === 'INFEASIBLE' || optimizerStatus === 'UNKNOWN' || optimizerStatus === 'MODEL_INVALID') {
                // Optimizer cannot find a solution → fall back to greedy
                console.warn('[AutoScheduler] Optimizer returned %s — falling back to greedy engine', optimizerStatus);
                usedFallback = true;
                validatedProposals = await greedyFallback(input.shifts, input.employees);
                uncoveredShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                // ── Parse + compliance validate ───────────────────────────────
                const { shiftMap, employeeMap } = solutionParser.buildMaps(input.shifts, input.employees);
                const { groups, uncoveredShiftIds: uncov } = solutionParser.parse(optimizeResponse, shiftMap, employeeMap);
                uncoveredShiftIds = uncov;

                const validationStart = performance.now();
                validatedProposals = await this._validateProposals(groups);
                console.debug('[AutoScheduler] Compliance validation: %dms', Math.round(performance.now() - validationStart));
            }
        } catch (err) {
            if (err instanceof OptimizerError && err.code === 'CONNECTION_REFUSED') {
                console.warn('[AutoScheduler] Optimizer offline — falling back to greedy engine');
                usedFallback = true;
                optimizerStatus = 'UNKNOWN';
                validatedProposals = await greedyFallback(input.shifts, input.employees);
                uncoveredShiftIds = validatedProposals.filter(p => !p.passing).map(p => p.shiftId);
            } else {
                throw err;
            }
        }

        const passing = validatedProposals.filter(p => p.passing).length;
        const failing = validatedProposals.length - passing;

        const result: AutoSchedulerResult = {
            optimizerStatus,
            solveTimeMs,
            validationTimeMs: Math.round(performance.now() - t0) - solveTimeMs,
            totalProposals: validatedProposals.length,
            passing,
            failing,
            uncoveredShiftIds,
            proposals: validatedProposals,
            canCommit: passing > 0,
            usedFallback,
        };

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

        let totalCommitted = 0;
        const failedEmployees: string[] = [];
        const concurrencyConflicts: string[] = [];

        for (const [employeeId, shiftIds] of byEmployee) {
            // ── Concurrency recheck: re-simulate with fresh DB state ──────────
            let freshResult: BulkAssignmentResult;
            try {
                freshResult = await bulkAssignmentController.simulate(
                    shiftIds, employeeId, { mode: 'PARTIAL_APPLY' },
                );
            } catch (err) {
                console.error('[AutoScheduler] Recheck failed for employee', employeeId, err);
                failedEmployees.push(employeeId);
                continue;
            }

            // Detect new conflicts (shifts that passed preview but fail recheck)
            const nowFailing = freshResult.failedShiftIds;
            concurrencyConflicts.push(...nowFailing);

            if (freshResult.passedShiftIds.length === 0) {
                console.warn('[AutoScheduler] All shifts failed recheck for', employeeId);
                failedEmployees.push(employeeId);
                continue;
            }

            // ── Atomic commit via sm_bulk_assign RPC ─────────────────────────
            try {
                const commitResult = await bulkAssignmentController.commit(freshResult, employeeId);
                if (commitResult.success) {
                    totalCommitted += commitResult.committed.length;
                    if (nowFailing.length > 0) {
                        console.warn('[AutoScheduler] Concurrency: skipped %d shifts for %s', nowFailing.length, employeeId);
                    }
                } else {
                    failedEmployees.push(employeeId);
                }
            } catch (err) {
                console.error('[AutoScheduler] Commit error for', employeeId, err);
                failedEmployees.push(employeeId);
            }
        }

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
}

export const autoSchedulerController = new AutoSchedulerController();
