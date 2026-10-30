import { V8Hit, V8RuleEvaluator } from '../types';
import { consecutivePairs } from '../utils/rest-gap';

/**
 * V8 Rule: No Overlap
 *
 * Ensures no employee has two shifts that overlap in time. Shifts are compared
 * on the absolute timeline, so an overnight shift overlaps the next morning's:
 * this used to compare same-start-day pairs only, and that case fell between
 * it and the rest-gap rule, which skips negative gaps as this rule's.
 */
export const noOverlapRule: V8RuleEvaluator = (ctx) => {
    const violations: V8Hit[] = [];

    for (const { a, b, gapMinutes } of consecutivePairs(ctx.shifts)) {
        if (gapMinutes >= 0) continue;
        violations.push({
            rule_id: 'V8_NO_OVERLAP',
            rule_name: 'No Overlap',
            status: 'BLOCKING',
            summary: 'Overlapping shifts detected',
            details: `Shift on ${a.date} (${a.start_time}-${a.end_time}) overlaps with the shift on ${b.date} (${b.start_time}-${b.end_time}).`,
            affected_shifts: [a.id, b.id],
            blocking: true
        });
    }

    return violations;
};

// NOTE: The former `minShiftLengthRule` (V8_MIN_SHIFT_LENGTH / R02) was removed.
// Minimum-duration enforcement is now owned solely by `minEngagementRule`
// (V8_MIN_ENGAGEMENT), which handles the training / weekday / Sunday-PH tiers in
// one place. See ./min-engagement.ts.
