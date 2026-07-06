import { V8Hit, V8RuleEvaluator } from '../types';
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

// NOTE: The former `minShiftLengthRule` (V8_MIN_SHIFT_LENGTH / R02) was removed.
// Minimum-duration enforcement is now owned solely by `minEngagementRule`
// (V8_MIN_ENGAGEMENT), which handles the training / weekday / Sunday-PH tiers in
// one place. See ./min-engagement.ts.
