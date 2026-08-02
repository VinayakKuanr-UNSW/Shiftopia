/**
 * V8 Compliance Engine — Swap Engine
 */

import { SwapScenario, SolverResult, ConstraintViolation, SolverConfig } from './types';
import { v8Engine, V8Engine } from '../engine';
import { V8ContractType, V8Employee, V8Shift, V8Status } from '../types';
import { ComplianceResult, ComplianceCalculation } from '../../types';

/**
 * Map a party's employment status ('FT'|'PT'|'CASUAL'|null) onto the V8 engine's
 * ContractType. Absent/null → 'CASUAL' so behaviour is unchanged when no context
 * is supplied (CASUAL is exempt from V8_ORD_HOURS_AVG).
 */
function toV8ContractType(t: 'FT' | 'PT' | 'CASUAL' | null | undefined): V8ContractType {
    switch (t) {
        case 'FT': return 'FULL_TIME';
        case 'PT': return 'PART_TIME';
        case 'CASUAL': return 'CASUAL';
        default: return 'CASUAL';
    }
}

export class V8SwapEngine {
    /**
     * Evaluate a swap scenario using the V8 engine.
     */
    evaluate(scenario: SwapScenario, config?: SolverConfig): SolverResult {
        const t0 = performance.now();

        // Honour the configurable cross-day rest gap (clause 40.2 — 8h by
        // written agreement). Absent config preserves the 10h default engine.
        const engine = config?.rest_gap_hours
            ? new V8Engine({ min_rest_gap_minutes: config.rest_gap_hours * 60 })
            : v8Engine;

        // 1. Evaluate Party A
        const empA: V8Employee = {
            id: scenario.partyA.employee_id,
            name: scenario.partyA.name,
            // Hydrated from the party's employment status. Absent/null → 'CASUAL'
            // (unchanged legacy behaviour; CASUAL is exempt from V8_ORD_HOURS_AVG).
            contract_type: toV8ContractType(scenario.partyA.contract_type ?? 'CASUAL'),
            contracted_weekly_hours: scenario.partyA.contracted_weekly_hours ?? 38,
            leave_days: scenario.partyA.leave_days,
            is_security_role: scenario.partyA.is_security_role,
        };
        const shiftsA: V8Shift[] = scenario.partyA.hypothetical_schedule.map(s => ({
            ...s,
            is_ordinary_hours: s.is_ordinary_hours ?? true,
            // Candidate scoping: the RECEIVED shift is the one this operation
            // adds; everything else is committed history that per-shift rules
            // (leave-conflict, min-engagement, meal-break) must not re-validate.
            is_candidate: s.is_candidate ?? (s.id === scenario.partyA.received_shift.id),
        }));

        const resultA = engine.evaluate(empA, shiftsA);

        // 2. Evaluate Party B
        const isDummy = scenario.partyB.employee_id === '__assignment_dummy__';
        let resultB = { passed: true, hits: [] as any[] };
        
        if (!isDummy) {
            const empB: V8Employee = {
                id: scenario.partyB.employee_id,
                name: scenario.partyB.name,
                // Audit C-4: this was hardcoded to 'CASUAL' regardless of the
                // party's real contract, silently exempting FT/PT employees
                // from V8_ORD_HOURS_AVG and the split-shift rule on every
                // swap. Mirror Party A's handling above.
                contract_type: toV8ContractType(scenario.partyB.contract_type ?? 'CASUAL'),
                contracted_weekly_hours: scenario.partyB.contracted_weekly_hours ?? 38,
                leave_days: scenario.partyB.leave_days,
                is_security_role: scenario.partyB.is_security_role,
            };
            const shiftsB: V8Shift[] = scenario.partyB.hypothetical_schedule.map(s => ({
                ...s,
                is_ordinary_hours: s.is_ordinary_hours ?? true,
                is_candidate: s.is_candidate ?? (s.id === scenario.partyB.received_shift.id),
            }));
            resultB = engine.evaluate(empB, shiftsB);
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
