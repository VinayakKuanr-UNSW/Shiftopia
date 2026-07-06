import { V8Hit, V8RuleEvaluator } from '../types';
import {
    consecutivePairs,
    pairInvolvesMultiHire,
    shiftStartDate,
    MULTI_HIRE_MIN_REST_MINUTES,
} from '../utils/rest-gap';

/**
 * V8 Rule: Minimum Rest Gap (ICC EBA clause 40 — Breaks Between Shifts)
 *
 * Enforces the minimum rest period between "the completion of work on the one
 * day and the commencement of work on the next day". This is a CROSS-DAY
 * provision: two shifts that START on the same calendar day are NOT a rest-gap
 * concern — they are governed by the split-shift rule (clause 39) and the
 * spread-of-hours cap (clause 39.2). Same-day pairs are therefore skipped here.
 *
 * Configuration:
 *   - Default minimum is 10h (600 min, clause 40.1).
 *   - By written mutual agreement the minimum may be reduced to 8h
 *     (clause 40.2) — supplied via `config.min_rest_gap_minutes`.
 *   - Multi-hire engagements only require an 8h break regardless of the
 *     configured minimum (clause 40.3 / 13.1(f)).
 */
export const minRestGapRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;

    const pairs = consecutivePairs(shifts);
    if (pairs.length === 0) return [];

    const violations: V8Hit[] = [];
    const mode = config.min_rest_gap_minutes < 600 ? 'relaxed' : 'standard';

    for (const { a, b, gapMinutes, sameStartDay } of pairs) {
        // Clause 40 applies only BETWEEN days. Same-start-day pairs are a
        // split-shift / spread concern, not a rest-gap one.
        if (sameStartDay) continue;
        // Overlaps are owned by NO_OVERLAP; a negative gap is not "rest".
        if (gapMinutes < 0) continue;

        // Multi-hire engagements only require an 8h break (clause 40.3).
        const isMultiHire = pairInvolvesMultiHire(a, b);
        const requiredMinutes = isMultiHire
            ? Math.min(config.min_rest_gap_minutes, MULTI_HIRE_MIN_REST_MINUTES)
            : config.min_rest_gap_minutes;

        if (gapMinutes < requiredMinutes) {
            const gapHours = Math.round((gapMinutes / 60) * 10) / 10;
            violations.push({
                rule_id: 'V8_MIN_REST_GAP',
                rule_name: 'Minimum Rest Gap',
                status: 'BLOCKING',
                summary: `Insufficient rest between days (${gapHours}h)`,
                details:
                    `Only ${gapHours}h rest between the shift on ${shiftStartDate(a)} and the shift on ` +
                    `${shiftStartDate(b)}. Minimum required is ${requiredMinutes / 60}h` +
                    `${isMultiHire ? ' (multi-hire engagement)' : ''}.`,
                affected_shifts: [a.id, b.id],
                blocking: true,
                calculation: {
                    gap_minutes: gapMinutes,
                    gap_hours: gapHours,
                    required_minutes: requiredMinutes,
                    limit: requiredMinutes / 60,
                    rest_gap_mode: mode,
                    // Viz shape (MinRestGapViz): the violating gap sits AFTER
                    // shift a and BEFORE shift b.
                    prev_day_gap_hours: gapHours,
                    next_day_gap_hours: null,
                    shift_a: a.id,
                    shift_b: b.id,
                },
            });
        }
    }

    return violations;
};
