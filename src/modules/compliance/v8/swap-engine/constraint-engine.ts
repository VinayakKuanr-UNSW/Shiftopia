/**
 * V8 Compliance Engine — Swap Engine
 */

import { V8SwapScenario, V8SwapResult, V8SwapViolation } from './types';
import { v8Engine } from '../engine';
import { V8Employee, V8Shift } from '../types';

export class V8SwapEngine {
    runV8SwapEvaluation(scenario: V8SwapScenario): V8SwapResult {
        const t0 = performance.now();

        // Map Party A
        const empA: V8Employee = {
            id: scenario.partyA.employee_id,
            name: scenario.partyA.name,
            contract_type: 'CASUAL',
            contracted_weekly_hours: 38
        };
        const shiftsA: V8Shift[] = scenario.partyA.hypothetical_schedule.map(s => ({
            id: (s as any).id || `shift-${Math.random()}`,
            date: s.date,
            start_time: s.start_time,
            end_time: s.end_time,
            is_ordinary_hours: true
        }));

        const resultA = v8Engine.evaluate(empA, shiftsA);

        // Map Party B
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
                id: (s as any).id || `shift-${Math.random()}`,
                date: s.date,
                start_time: s.start_time,
                end_time: s.end_time,
                is_ordinary_hours: true
            }));
            resultB = v8Engine.evaluate(empB, shiftsB);
        }

        const all_results: V8SwapViolation[] = [
            ...resultA.hits.map(h => ({
                id: h.rule_id,
                name: h.rule_name,
                employee_id: scenario.partyA.employee_id,
                status: h.status,
                summary: h.summary,
                details: h.details,
                blocking: h.blocking
            })),
            ...resultB.hits.map(h => ({
                id: h.rule_id,
                name: h.rule_name,
                employee_id: scenario.partyB.employee_id,
                status: h.status,
                summary: h.summary,
                details: h.details,
                blocking: h.blocking
            }))
        ];

        return {
            feasible: resultA.passed && resultB.passed,
            violations: all_results.filter(r => r.status === 'BLOCKING'),
            warnings: all_results.filter(r => r.status === 'WARNING'),
            all_results,
            solve_time_ms: Math.round(performance.now() - t0)
        };
    }
}
