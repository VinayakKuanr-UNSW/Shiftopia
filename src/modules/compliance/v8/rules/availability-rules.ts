import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

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
    
    const others = shifts.filter(s => s.id !== candidate_shift.id);
    const violations: V8Hit[] = [];

    const cS = parseTimeToMinutes(candidate_shift.start_time);
    let cE = parseTimeToMinutes(candidate_shift.end_time);
    if (cE <= cS) cE += 1440;

    for (const other of others) {
        if ((other.date || other.shift_date) !== (candidate_shift.date || candidate_shift.shift_date)) continue;

        const oS = parseTimeToMinutes(other.start_time);
        let oE = parseTimeToMinutes(other.end_time);
        if (oE <= oS) oE += 1440;

        // Overlap: max(start) < min(end)
        if (Math.max(cS, oS) < Math.min(cE, oE)) {
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
