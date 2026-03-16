/**
 * Constraint Engine — Layer 3
 *
 * Evaluates ALL registered constraints simultaneously against a SwapScenario.
 * Unlike sequential rule checking, every constraint sees the full hypothetical
 * schedule for both parties at once — this prevents hidden rule interactions
 * and catches compound violations (e.g. hours + rest + visa together).
 *
 * Analogous to CP-SAT feasibility check in Google OR-Tools:
 *   solver.solve(scenario, constraints) → feasible / infeasible
 */

import type {
    SolverConstraint,
    SwapScenario,
    SolverConfig,
    SolverResult,
    ConstraintViolation,
} from './types';
import type { ComplianceResult } from '../types';

import {
    NoOverlapConstraint,
    MinShiftLengthConstraint,
    MaxDailyHoursConstraint,
    WorkingDaysCapConstraint,
    StudentVisa48hConstraint,
    AvgFourWeekConstraint,
    MinRestGapConstraint,
    SplitShiftSpreadConstraint,
} from './constraints';

// =============================================================================
// REGISTERED CONSTRAINTS (order does NOT matter — all evaluated together)
// =============================================================================

const ALL_CONSTRAINTS: SolverConstraint[] = [
    // Scheduling rules (Rules 4–10)
    NoOverlapConstraint,
    MinShiftLengthConstraint,
    MaxDailyHoursConstraint,
    WorkingDaysCapConstraint,
    StudentVisa48hConstraint,
    AvgFourWeekConstraint,
    MinRestGapConstraint,
    // Additional constraints (edge cases)
    SplitShiftSpreadConstraint,    // Case #5: split shift day spread
];

// =============================================================================
// ENGINE
// =============================================================================

export class ConstraintEngine {
    private constraints: SolverConstraint[];

    constructor(constraints: SolverConstraint[] = ALL_CONSTRAINTS) {
        this.constraints = constraints;
    }

    /**
     * Evaluate the scenario against all constraints simultaneously.
     * Returns a SolverResult indicating feasibility and all violations.
     *
     * Emits a structured observability log per PRD §10:
     *   action_type, employee_ids, shifts_evaluated, solve_time_ms, violations_count
     */
    evaluate(scenario: SwapScenario, config: SolverConfig = {}): SolverResult {
        const t0 = performance.now();

        const active = config.exclude_constraints
            ? this.constraints.filter(c => !config.exclude_constraints!.includes(c.id))
            : this.constraints;

        const allResults: ConstraintViolation[] = [];

        // All constraints run simultaneously — no ordering dependency
        for (const constraint of active) {
            const results = constraint.evaluate(scenario, config);
            allResults.push(...results);
        }

        const violations = allResults.filter(r => r.status === 'fail');
        const warnings = allResults.filter(r => r.status === 'warning');
        const blockingViolations = violations.filter(r => r.blocking);
        const feasible = blockingViolations.length === 0;

        // §10 Observability — structured log for every solver run
        const shiftsA = scenario.partyA.hypothetical_schedule.length;
        const shiftsB = scenario.partyB.hypothetical_schedule.length;
        const isDummy = scenario.partyB.employee_id === '__assignment_dummy__';
        console.debug('[compliance_solver_run]', {
            action:           config.action_type ?? 'swap',
            employees:        isDummy
                ? [scenario.partyA.employee_id]
                : [scenario.partyA.employee_id, scenario.partyB.employee_id],
            shifts_evaluated: isDummy ? shiftsA : shiftsA + shiftsB,
            solve_time_ms:    Math.round(performance.now() - t0),
            violations_count: violations.length,
            feasible,
        });

        return {
            feasible,
            violations,
            warnings,
            all_results: allResults,
            scenario,
        };
    }
}

// =============================================================================
// ADAPTER: SolverResult → Record<string, ComplianceResult>
// =============================================================================

/**
 * Converts a SolverResult to the per-rule ComplianceResult map expected by
 * ComplianceTabContent and other legacy UI components.
 *
 * For each constraint, the two per-party results are merged into one:
 *   - Both pass  → pass,  "Checks passed for both employees"
 *   - One fails  → fail,  "[FailingParty] {summary}"
 *   - Both fail  → fail,  "Both parties failed {name}"
 */
export function solverResultToComplianceResults(
    result: SolverResult,
): Record<string, ComplianceResult> {
    const partyAId = result.scenario.partyA.employee_id;
    const partyAName = result.scenario.partyA.name;
    const partyBName = result.scenario.partyB.name;

    // Group results by constraint ID
    const byConstraint = new Map<string, ConstraintViolation[]>();
    for (const r of result.all_results) {
        if (!byConstraint.has(r.constraint_id)) byConstraint.set(r.constraint_id, []);
        byConstraint.get(r.constraint_id)!.push(r);
    }

    const map: Record<string, ComplianceResult> = {};

    for (const [constraintId, violations] of byConstraint.entries()) {
        const aResult = violations.find(v => v.employee_id === partyAId);
        const bResult = violations.find(v => v.employee_id !== partyAId);

        const aFailed = aResult?.status === 'fail';
        const bFailed = bResult?.status === 'fail';
        const aWarn = aResult?.status === 'warning';
        const bWarn = bResult?.status === 'warning';

        let mergedStatus: 'pass' | 'fail' | 'warning' = 'pass';
        if (aFailed || bFailed) mergedStatus = 'fail';
        else if (aWarn || bWarn) mergedStatus = 'warning';

        let summary: string;
        if (aFailed && bFailed) {
            summary = `Both parties failed — ${violations[0].constraint_name}`;
        } else if (aFailed) {
            summary = `[${partyAName}] ${aResult!.summary}`;
        } else if (bFailed) {
            summary = `[${partyBName}] ${bResult!.summary}`;
        } else if (aWarn || bWarn) {
            const warnRes = aWarn ? aResult! : bResult!;
            const warnName = aWarn ? partyAName : partyBName;
            summary = `[${warnName}] ${warnRes.summary}`;
        } else {
            summary = 'Checks passed for both employees';
        }

        let details: string;
        const parts: string[] = [];
        if (aResult && aResult.status !== 'pass') parts.push(`[${partyAName}] ${aResult.details}`);
        if (bResult && bResult.status !== 'pass') parts.push(`[${partyBName}] ${bResult.details}`);
        details = parts.length > 0 ? parts.join('\n') : 'Both employees passed this check.';

        map[constraintId] = {
            rule_id: constraintId,
            rule_name: violations[0].constraint_name,
            status: mergedStatus,
            summary,
            details,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: 0,
                partyA_calc: aResult?.calculation ?? null,
                partyB_calc: bResult?.calculation ?? null,
                requester_candidate: {
                    start: result.scenario.partyA.received_shift.start_time,
                    end: result.scenario.partyA.received_shift.end_time,
                },
                offerer_candidate: {
                    start: result.scenario.partyB.received_shift.start_time,
                    end: result.scenario.partyB.received_shift.end_time,
                },
            },
            blocking: violations[0].blocking,
        };
    }

    return map;
}
