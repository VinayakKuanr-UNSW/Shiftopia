import { v8Engine } from '../engine';
import { V8Employee, V8Shift } from '../types';
import { ComplianceCheckInput, ComplianceResult } from '../../types';

/**
 * Adapter: V1 Input -> V8 Engine (Full Mapping)
 * 
 * Maps the legacy ComplianceCheckInput to the V8 Engine format.
 * Returns ALL V8 hits mapped back to the V1 ComplianceResult format.
 */
export function runV8Compliance(input: ComplianceCheckInput): ComplianceResult[] {
    // 1. Map Employee
    const employee: V8Employee = {
        id: input.employee_id || 'unassigned',
        name: 'Employee',
        contract_type: 'CASUAL', // Default
        contracted_weekly_hours: 38
    };

    // 2. Map Shifts
    const v8Shifts: V8Shift[] = [
        ...input.existing_shifts.map(s => ({
            id: (s as any).id || `existing-${Math.random()}`,
            date: s.shift_date,
            start_time: s.start_time,
            end_time: s.end_time,
            is_ordinary_hours: true,
            unpaid_break_minutes: s.unpaid_break_minutes || 0
        }))
    ];

    if (input.candidate_shift) {
        v8Shifts.push({
            id: 'candidate',
            date: input.candidate_shift.shift_date,
            start_time: input.candidate_shift.start_time,
            end_time: input.candidate_shift.end_time,
            is_ordinary_hours: true,
            unpaid_break_minutes: input.candidate_shift.unpaid_break_minutes || 0
        });
    }

    // 3. Run V8
    const v8Result = v8Engine.evaluate(employee, v8Shifts);

    // 4. Map ALL V8 Hits back to V1 ComplianceResult[]
    return v8Result.hits.map(hit => ({
        rule_id: hit.rule_id,
        rule_name: hit.rule_name,
        status: hit.status === 'BLOCKING' ? 'fail' : hit.status === 'WARNING' ? 'warning' : 'pass',
        summary: hit.summary,
        details: hit.details,
        blocking: hit.blocking,
        calculation: {
            existing_hours: hit.calculation?.existing_hours || 0,
            candidate_hours: hit.calculation?.candidate_hours || 0,
            total_hours: hit.calculation?.total_hours || 0,
            limit: hit.calculation?.limit || 0,
            ...hit.calculation
        }
    }));
}
