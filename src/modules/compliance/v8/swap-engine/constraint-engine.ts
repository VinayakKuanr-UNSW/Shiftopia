/**
 * V8 Compliance Engine — Swap Engine
 */

import { SwapScenario, SolverResult, ConstraintViolation, SolverConfig } from './types';
import { v8Engine } from '../engine';
import { V8Employee, V8Shift, V8Status } from '../types';
import { ComplianceResult, ComplianceCalculation } from '../../types';

export class V8SwapEngine {
    /**
     * Evaluate a swap scenario using the V8 engine.
     */
    evaluate(scenario: SwapScenario, config?: SolverConfig): SolverResult {
        const t0 = performance.now();

        // 1. Evaluate Party A
        const empA: V8Employee = {
            id: scenario.partyA.employee_id,
            name: scenario.partyA.name,
            contract_type: 'CASUAL', // Default, bridge will hydrate if needed
            contracted_weekly_hours: 38
        };
        const shiftsA: V8Shift[] = scenario.partyA.hypothetical_schedule.map(s => ({
            ...s,
            is_ordinary_hours: s.is_ordinary_hours ?? true
        }));

        const resultA = v8Engine.evaluate(empA, shiftsA);

        // 2. Evaluate Party B
        const isDummy = scenario.partyB.employee_id === '__assignment_dummy__';
        let resultB = { passed: true, hits: [] as any[] };
        
        if (!isDummy) {
            const empB: V8Employee = {
                id: scenario.partyB.employee_id,
                name: scenario.partyB.name,
                contract_type: 'CASUAL',
                contracted_weekly_hours: 38
            };
            const shiftsB: V8Shift[] = scenario.partyB.hypothetical_schedule.map(s => ({
                ...s,
                is_ordinary_hours: s.is_ordinary_hours ?? true
            }));
            resultB = v8Engine.evaluate(empB, shiftsB);
        }

        // 3. Aggregate Results
        const all_results: ConstraintViolation[] = [
            ...resultA.hits.map(h => ({
                id: h.rule_id,
                constraint_id: h.rule_id,
                name: h.rule_name,
                constraint_name: h.rule_name,
                employee_id: scenario.partyA.employee_id,
                status: (h.status === 'BLOCKING' ? 'fail' : h.status === 'WARNING' ? 'warning' : 'pass') as any,
                summary: h.summary,
                details: h.details,
                blocking: h.blocking,
                calculation: h.calculation
            })),
            ...resultB.hits.map(h => ({
                id: h.rule_id,
                constraint_id: h.rule_id,
                name: h.rule_name,
                constraint_name: h.rule_name,
                employee_id: scenario.partyB.employee_id,
                status: (h.status === 'BLOCKING' ? 'fail' : h.status === 'WARNING' ? 'warning' : 'pass') as any,
                summary: h.summary,
                details: h.details,
                blocking: h.blocking,
                calculation: h.calculation
            }))
        ];

        return {
            feasible: resultA.passed && resultB.passed,
            violations: all_results.filter(r => r.status === 'fail'),
            warnings: all_results.filter(r => r.status === 'warning'),
            all_results,
            solve_time_ms: Math.round(performance.now() - t0),
            scenario
        };
    }
}

/**
 * Helper to convert SolverResult to legacy ComplianceResult map.
 */
export function solverResultToComplianceResults(
    result: SolverResult,
    employeeId: string,
): Record<string, ComplianceResult> {
    const map: Record<string, ComplianceResult> = {};

    for (const r of result.all_results) {
        if (r.employee_id !== employeeId) continue;

        map[r.id] = {
            rule_id:   r.id,
            rule_name: r.name,
            status:    r.status as any,
            summary:   r.summary,
            details:   r.details,
            blocking:  r.blocking,
            calculation: {
                existing_hours:   0,
                candidate_hours:  0,
                total_hours:      0,
                limit:            0,
                ...r.calculation,
            } as ComplianceCalculation,
        };
    }

    return map;
}
