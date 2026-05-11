import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Minimum Rest Gap
 * 
 * Enforces a mandatory 10-hour (600 min) rest period between any two shifts.
 */
export const minRestGapRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;
    
    // 1. Filter and sort shifts chronologically
    const sorted = [...shifts]
        .filter(s => !!(s.date || s.shift_date) && !!s.start_time && !!s.end_time)
        .sort((a, b) => {
            const dA = a.date || a.shift_date || '';
            const dB = b.date || b.shift_date || '';
            if (dA !== dB) return dA.localeCompare(dB);
            return parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time);
        });
    
    if (sorted.length < 2) return [];
    const violations: V8Hit[] = [];
    
    // 2. Scan consecutive pairs
    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        
        const dateCurrent = current.date || current.shift_date || '';
        const dateNext = next.date || next.shift_date || '';
        
        const currentStart = parseTimeToMinutes(current.start_time);
        let currentEnd = parseTimeToMinutes(current.end_time);
        if (currentEnd <= currentStart) currentEnd += 1440; // Segment end (next day if overnight)

        const nextStart = parseTimeToMinutes(next.start_time);
        
        let gapMins = 0;
        
        if (dateCurrent === dateNext) {
            gapMins = nextStart - currentEnd;
        } else {
            // Assume consecutive days for simplicity in rest-gap
            gapMins = (1440 - currentEnd) + nextStart;
            
            // If more than 1 day apart, gap is definitely > 10h
            const d1 = new Date(dateCurrent).getTime();
            const d2 = new Date(dateNext).getTime();
            // 86400000 ms = 1 day. If diff > 1 day, gap is huge.
            if (d2 - d1 > 86400000) continue; 
        }

        if (gapMins < 0) continue; // Handled by NoOverlap
        
        if (gapMins < config.min_rest_gap_minutes) {
            violations.push({
                rule_id: 'V8_MIN_REST_GAP',
                rule_name: 'Minimum Rest Gap',
                status: 'BLOCKING',
                summary: `Insufficient rest between shifts (${Math.round(gapMins / 60)}h)`,
                details: `Only ${Math.round(gapMins / 60)}h rest provided between shifts on ${dateCurrent} and ${dateNext}. Minimum requirement is ${config.min_rest_gap_minutes / 60}h.`,
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
