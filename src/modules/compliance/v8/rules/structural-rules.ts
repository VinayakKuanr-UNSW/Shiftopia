import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: No Overlap
 * 
 * Ensures no employee has two shifts that overlap in time.
 */
export const noOverlapRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    if (shifts.length < 2) return [];

    // 1. Filter out incomplete shifts and sort by minutes-since-epoch
    const sorted = [...shifts]
        .filter(s => !!(s.date || s.shift_date) && !!s.start_time)
        .sort((a, b) => {
        const dA = a.date || a.shift_date || '';
        const dB = b.date || b.shift_date || '';
        if (dA !== dB) return dA.localeCompare(dB);
        
        const tA = parseTimeToMinutes(a.start_time || '00:00');
        const tB = parseTimeToMinutes(b.start_time || '00:00');
        return tA - tB;
    });

    const violations: V8Hit[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];

        const dateCurrent = current.date || current.shift_date || '';
        const dateNext = next.date || next.shift_date || '';
        
        // Only check overlap if on same day (multi-day overlap handled by shift duration rules)
        if (dateCurrent !== dateNext) continue;

        const currentStart = parseTimeToMinutes(current.start_time || '00:00');
        let currentEnd = parseTimeToMinutes(current.end_time || '00:00');
        const nextStart = parseTimeToMinutes(next.start_time || '00:00');

        // Handle cross-midnight segment of the current shift
        if (currentEnd <= currentStart) currentEnd += 1440;

        if (nextStart < currentEnd) {
            violations.push({
                rule_id: 'V8_NO_OVERLAP',
                rule_name: 'No Overlap',
                status: 'BLOCKING',
                summary: 'Overlapping shifts detected',
                details: `Shift on ${current.date} (${current.start_time}-${current.end_time}) overlaps with shift (${next.start_time}-${next.end_time}).`,
                affected_shifts: [current.id, next.id],
                blocking: true
            });
        }
    }

    return violations;
};

/**
 * V8 Rule: Minimum Shift Length
 * 
 * Enforces the minimum duration (usually 2h, 3h, or 4h) based on shift type.
 */
export const minShiftLengthRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        const start = parseTimeToMinutes(s.start_time || '00:00');
        let end = parseTimeToMinutes(s.end_time || '00:00');
        
        let mins = end - start;
        if (mins <= 0) mins += 1440; // Cross-midnight

        // Default min is 2h (120m) for training, 3h (180m) for regular
        const requiredMins = s.is_training ? 120 : 180;

        if (mins < requiredMins) {
            violations.push({
                rule_id: 'V8_MIN_SHIFT_LENGTH',
                rule_name: 'Minimum Shift Length',
                status: 'BLOCKING',
                summary: `Shift too short (${mins}m)`,
                details: `Shift on ${s.date} is only ${mins} minutes long. Minimum required is ${requiredMins} minutes.`,
                affected_shifts: [s.id],
                blocking: true
            });
        }
    }

    return violations;
};
