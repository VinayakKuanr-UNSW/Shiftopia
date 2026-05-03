/**
 * BulkAssignmentController — Orchestrates the full bulk assignment pipeline.
 *
 * Incremental Feasibility Assignment algorithm:
 *
 *   For each candidate shift (sorted chronologically):
 *     1. Run IncrementalValidator (rules 1–6, pre-flight)
 *     2. If no blocking pre-flight violations:
 *        → Run ComplianceEvaluator (rules 7–10, constraint solver)
 *     3. Build ShiftAssignmentResult via ConflictReporter
 *     4. If passing → append to SimulatedRoster.proposedAssignments
 *        (so next shift is validated against the updated roster)
 *
 * On commit():
 *   - ALWAYS re-simulates with fresh data before writing to DB (TOCTOU guard).
 *     If the employee's schedule changed since simulate() was called, stale
 *     results are discarded and only the freshly-validated passing set is committed.
 *   - PARTIAL_APPLY: assign only freshly-passing shiftIds
 *   - ALL_OR_NOTHING: fail if any shift has a blocking violation
 *
 * Usage:
 *   const result = await controller.simulate(shiftIds, employeeId, options);
 *   if (result.canCommit) await controller.commit(result, employeeId);
 */

import { scenarioLoader }        from './engine/scenario-loader';
import { shiftSorter }           from './engine/shift-sorter';
import { incrementalValidator }  from './engine/incremental-validator';
import { complianceEvaluator }   from './engine/compliance-evaluator';
import { conflictReporter }      from './engine/conflict-reporter';
import { assignmentCommitter }   from './engine/assignment-committer';
import type {
    BulkAssignmentOptions,
    BulkAssignmentResult,
    SimulatedRoster,
} from './types';
import type { CommitResult } from './engine/assignment-committer';

// =============================================================================
// CONTROLLER
// =============================================================================

export class BulkAssignmentController {
    /**
     * Simulate bulk assignment — validate all shifts, build compliance results.
     * Does NOT write to the database.
     *
     * @param shiftIds   - Selected shift IDs from the planner
     * @param employeeId - The employee to assign
     * @param options    - Mode (PARTIAL_APPLY | ALL_OR_NOTHING) + skip flags
     */
    async simulate(
        shiftIds: string[],
        employeeId: string,
        options: BulkAssignmentOptions = { mode: 'PARTIAL_APPLY' },
    ): Promise<BulkAssignmentResult> {
        const t0 = performance.now();

        console.debug('[BulkAssignmentController] Simulating', shiftIds.length, 'shifts for', employeeId);

        // ── Step 1: Load scenario ────────────────────────────────────────────
        const scenario = await scenarioLoader.load(shiftIds, employeeId);
        const { candidateShifts, existingShifts, employee } = scenario;

        // ── Step 2: Sort candidates chronologically ──────────────────────────
        const sortedCandidates = shiftSorter.sort(candidateShifts);

        // ── Step 3: Build initial SimulatedRoster ────────────────────────────
        const roster: SimulatedRoster = {
            existingShifts,
            proposedAssignments: [],
        };

        // ── Step 4: Incremental validation ──────────────────────────────────
        const resultMap = new Map<string, ReturnType<typeof conflictReporter.build>>();

        for (const shift of sortedCandidates) {
            // Rule 1–6: Pre-flight checks
            // required_skills + required_licenses are fetched as part of the
            // candidate shift select in ScenarioLoader._fetchCandidateShifts().
            const shiftRequiredQuals = [
                ...(shift.required_skills ?? []),
                ...(shift.required_licenses ?? []),
            ];
            const preFlightViolations = incrementalValidator.validate(
                shift,
                employee,
                roster,
                shiftRequiredQuals,
                options.skipQualificationChecks ?? false,
            );

            // Rule 7–10: Constraint solver (only if no blocking pre-flight failures)
            const hasBlockingPreFlight = preFlightViolations.some(v => v.blocking);
            const solverViolations = hasBlockingPreFlight
                ? []
                : complianceEvaluator.evaluate(shift, employee, roster);

            // Build structured result
            const result = conflictReporter.build(
                shift,
                employeeId,
                preFlightViolations,
                solverViolations,
            );

            resultMap.set(shift.id, result);

            // If passing → add to SimulatedRoster so subsequent shifts are
            // validated against the growing proposed schedule
            if (result.passing) {
                roster.proposedAssignments.push(shift);
            }
        }

        // ── Step 5: Aggregate results ────────────────────────────────────────
        // Preserve the original input order (not the sorted order)
        const results = shiftIds.map(id => {
            const result = resultMap.get(id);
            if (result) return result;
            // Shift wasn't found in DB — treat as FAIL
            return {
                shiftId: id,
                employeeId,
                shiftDate: '',
                startTime: '',
                endTime: '',
                status: 'FAIL' as const,
                violations: [{
                    violation_type: 'DRAFT_STATE' as const,
                    description: 'Shift not found in database.',
                    blocking: true,
                }],
                passing: false,
            };
        });

        const passedV8ShiftIds = results.filter(r => r.passing).map(r => r.shiftId);
        const failedV8ShiftIds = results.filter(r => !r.passing).map(r => r.shiftId);

        let canCommit: boolean;
        if (options.mode === 'ALL_OR_NOTHING') {
            canCommit = failedV8ShiftIds.length === 0;
        } else {
            canCommit = passedV8ShiftIds.length > 0;
        }

        const validationMs = Math.round(performance.now() - t0);

        console.debug('[BulkAssignmentController] Simulation complete:', {
            total: shiftIds.length,
            passing: passedV8ShiftIds.length,
            failing: failedV8ShiftIds.length,
            validationMs,
        });

        return {
            mode: options.mode,
            total: shiftIds.length,
            passing: passedV8ShiftIds.length,
            failing: failedV8ShiftIds.length,
            results,
            passedV8ShiftIds,
            failedV8ShiftIds,
            canCommit,
            validationMs,
        };
    }

    /**
     * Commit the assignment to the database.
     *
     * TOCTOU GUARD: always re-simulates with fresh data immediately before
     * writing.  Any shifts that were passing at simulate() time but are now
     * non-compliant (because another assignment changed the employee's schedule)
     * are dropped from the commit set.
     *
     * In PARTIAL_APPLY mode → commits freshly-passing shiftIds only.
     * In ALL_OR_NOTHING mode → fails if any shift now has a blocking violation.
     *
     * @param simulationResult - Original output from simulate() (used only for shift IDs + mode)
     * @param employeeId       - Target employee
     */
    async commit(
        simulationResult: BulkAssignmentResult,
        employeeId: string,
    ): Promise<CommitResult> {
        if (!simulationResult.canCommit) {
            return {
                success: false,
                committed: [],
                failed: simulationResult.failedV8ShiftIds,
                message: 'Cannot commit: blocking violations exist.',
            };
        }

        // Re-simulate with fresh DB data to catch any schedule changes since
        // the original simulation (another manager, another assignment flow, etc.)
        const allCandidateIds = [
            ...simulationResult.passedV8ShiftIds,
            ...simulationResult.failedV8ShiftIds,
        ];

        console.debug('[BulkAssignmentController] Re-simulating before commit (TOCTOU guard)');

        const freshResult = await this.simulate(
            allCandidateIds,
            employeeId,
            { mode: simulationResult.mode },
        );

        if (freshResult.passing === 0) {
            return {
                success:   false,
                committed: [],
                failed:    allCandidateIds,
                message:   'All shifts became non-compliant since validation — please re-check.',
            };
        }

        if (simulationResult.mode === 'ALL_OR_NOTHING' && freshResult.failing > 0) {
            return {
                success:   false,
                committed: [],
                failed:    freshResult.failedV8ShiftIds,
                message:   `${freshResult.failing} shift(s) have blocking violations — all-or-nothing mode requires all shifts to pass.`,
            };
        }

        return assignmentCommitter.commit(freshResult.passedV8ShiftIds, employeeId);
    }
}

/** Singleton controller. */
export const bulkAssignmentController = new BulkAssignmentController();
