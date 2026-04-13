/**
 * R07 — Minimum Rest Gap Between Shifts
 *
 * Checks each adjacent pair in the sorted relevant_shifts for a sufficient
 * rest gap between the end of shift A and the start of shift B.
 *
 * Uses absolute minutes (toAbsoluteMinutes) for cross-date comparison.
 * Also registers ConflictPairV2 entries — REST_GAP pairs are used by the
 * bidding engine to build the conflict graph.
 *
 * BLOCKING always.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { toAbsoluteMinutes, shiftGrossMinutes } from '../windows';

export const R07_rest_gap: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];
    const minGapMinutes = ctx.config.rest_gap_hours * 60;

    // Sort relevant_shifts by absolute start
    const sorted = [...ctx.relevant_shifts].sort((a, b) =>
        toAbsoluteMinutes(a.shift_date, a.start_time)
        - toAbsoluteMinutes(b.shift_date, b.start_time)
    );

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];

        // Same-day split shifts have no rest gap requirement — only cross-day
        // pairs (different shift_date) must satisfy the minimum rest gap.
        if (a.shift_date === b.shift_date) continue;

        const aStartAbs = toAbsoluteMinutes(a.shift_date, a.start_time);
        const aEndAbs   = aStartAbs + shiftGrossMinutes(a);
        const bStartAbs = toAbsoluteMinutes(b.shift_date, b.start_time);

        // Gap is only meaningful if b starts after a ends (no overlap)
        if (bStartAbs < aEndAbs) continue;    // R01 handles overlap

        const gapMinutes = bStartAbs - aEndAbs;

        if (gapMinutes < minGapMinutes) {
            const gapHours = (gapMinutes / 60).toFixed(2);
            hits.push({
                rule_id:  'R07_REST_GAP',
                severity: 'BLOCKING',
                message:
                    `Only ${gapHours}h rest between ${a.shift_date} ${a.start_time}–${a.end_time} `
                    + `and ${b.shift_date} ${b.start_time}–${b.end_time} `
                    + `— minimum is ${ctx.config.rest_gap_hours}h.`,
                resolution_hint:
                    `Ensure at least ${ctx.config.rest_gap_hours}h gap between these consecutive shifts.`,
                affected_shifts: [a.shift_id, b.shift_id],
            });

            ctx.conflict_pairs.push({
                shift_a:       a.shift_id,
                shift_b:       b.shift_id,
                rule_id:       'R07_REST_GAP',
                conflict_type: 'REST_GAP',
            });
        }
    }

    return hits;
};
