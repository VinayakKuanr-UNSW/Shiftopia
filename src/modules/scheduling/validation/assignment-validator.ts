/**
 * AssignmentValidator — Orchestrates the full proposal-validation pipeline.
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
    ValidationRunOptions,
    ValidationRunResult,
    SimulatedRoster,
} from './types';

// =============================================================================
// CONTROLLER
// =============================================================================

export class AssignmentValidator {
    /**
     * Validate every proposed (shift, employee) pair and build compliance results.
     * Does NOT write to the database.
     *
     * @param shiftIds   - Selected shift IDs from the planner
     * @param employeeId - The employee to assign
     * @param options    - Mode (PARTIAL_APPLY | ALL_OR_NOTHING) + skip flags
     */
    async simulate(
        shiftIds: string[],
        employeeId: string,
        options: ValidationRunOptions = { mode: 'PARTIAL_APPLY' },
    ): Promise<ValidationRunResult> {
        const t0 = performance.now();

        console.debug('[AssignmentValidator] Simulating', shiftIds.length, 'shifts for', employeeId);

        // ── Step 1: Load scenario ────────────────────────────────────────────
        const scenario = await scenarioLoader.load(shiftIds, employeeId, options.injectedData);
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
                    violation_type: 'SHIFT_NOT_FOUND' as const,
                    rule_name: 'Shift Not Found',
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

        console.debug('[AssignmentValidator] Simulation complete:', {
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
}

/** Singleton controller. */
export const assignmentValidator = new AssignmentValidator();
