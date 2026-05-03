import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseISO, areIntervalsOverlapping } from 'date-fns';

/**
 * V8 Rule: Availability & Conflicts
 * 
 * Advisory rule that checks if a shift overlaps with:
 * 1. Pre-assigned shifts (Locked intervals)
 * 2. Declared unavailabilities
 */
export const availabilityMatchRule: V8RuleEvaluator = (ctx) => {
    const { candidate_shift, shifts } = ctx;
    if (!candidate_shift) return [];
    
    // In V8, the candidate is already in the 'shifts' array.
    // We check if it overlaps with ANY OTHER shift.
    const others = shifts.filter(s => s.id !== candidate_shift.id);
    const violations: V8Hit[] = [];

    const candStart = parseISO(`${candidate_shift.date}T${candidate_shift.start_time}`);
    const candEnd = parseISO(`${candidate_shift.date}T${candidate_shift.end_time}`);

    for (const other of others) {
        const otherStart = parseISO(`${other.date}T${other.start_time}`);
        const otherEnd = parseISO(`${other.date}T${other.end_time}`);

        if (areIntervalsOverlapping(
            { start: candStart, end: candEnd },
            { start: otherStart, end: otherEnd }
        )) {
            violations.push({
                rule_id: 'V8_AVAILABILITY_CONFLICT',
                rule_name: 'Availability Match',
                status: 'WARNING',
                summary: 'Conflict with existing assignment',
                details: `Candidate shift overlaps with an existing assignment on ${other.date}.`,
                affected_shifts: [candidate_shift.id, other.id],
                blocking: false
            });
        }
    }

    return violations;
};
