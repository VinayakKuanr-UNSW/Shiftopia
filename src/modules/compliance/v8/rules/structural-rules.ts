import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

/**
 * V8 Rule: No Overlap
 * 
 * Ensures no employee has two shifts that overlap in time.
 */
export const noOverlapRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    if (shifts.length < 2) return [];

    const sorted = [...shifts].sort((a, b) => {
        const timeA = parseISO(`${a.date}T${a.start_time}`).getTime();
        const timeB = parseISO(`${b.date}T${b.start_time}`).getTime();
        return timeA - timeB;
    });

    const violations: V8Hit[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];

        const currentEnd = parseISO(`${current.date}T${current.end_time}`);
        const nextStart = parseISO(`${next.date}T${next.start_time}`);

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
    const { shifts, config } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        const start = parseISO(`${s.date}T${s.start_time}`);
        const end = parseISO(`${s.date}T${s.end_time}`);
        let mins = differenceInMinutes(end, start);
        if (mins < 0) mins += 1440; // Cross-midnight

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
