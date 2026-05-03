import { V8RuleContext, V8Hit, V8RuleEvaluator, V8Shift } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

/**
 * V8 Rule: Minimum Rest Gap
 * 
 * Enforces a mandatory 10-hour (600 min) rest period between any two shifts.
 */
export const minRestGapRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;
    if (shifts.length < 2) return [];
    
    // 1. Sort shifts chronologically
    const sorted = [...shifts].sort((a, b) => {
        const timeA = parseISO(`${a.date}T${a.start_time}`).getTime();
        const timeB = parseISO(`${b.date}T${b.start_time}`).getTime();
        return timeA - timeB;
    });
    
    const violations: V8Hit[] = [];
    
    // 2. Scan consecutive pairs
    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        
        const currentEnd = parseISO(`${current.date}T${current.end_time}`);
        const nextStart = parseISO(`${next.date}T${next.start_time}`);
        
        // Handle cross-midnight for the gap calculation
        let gapMins = differenceInMinutes(nextStart, currentEnd);
        if (gapMins < 0) {
            // This might be an overlap conflict or a cross-midnight shift
            // If it's a negative gap, we let NoOverlapRule handle it or adjust
            continue; 
        }
        
        if (gapMins < config.min_rest_gap_minutes) {
            violations.push({
                rule_id: 'V8_MIN_REST_GAP',
                rule_name: 'Minimum Rest Gap',
                status: 'BLOCKING',
                summary: `Insufficient rest between shifts (${Math.round(gapMins / 60)}h)`,
                details: `Only ${Math.round(gapMins / 60)}h rest provided between shifts on ${current.date} and ${next.date}. Minimum requirement is ${config.min_rest_gap_minutes / 60}h.`,
                affected_shifts: [current.id, next.id],
                blocking: true,
                calculation: {
                    gap_minutes: gapMins,
                    required_minutes: config.min_rest_gap_minutes,
                    shift_a: current.id,
                    shift_b: next.id
                }
            });
        }
    }
    
    return violations;
};
