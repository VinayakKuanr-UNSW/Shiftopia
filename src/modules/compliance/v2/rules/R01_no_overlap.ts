/**
 * R01 — No Overlapping Shifts
 *
 * Checks the sorted relevant_shifts for any pair where shift B starts
 * before shift A has ended (absolute time comparison, cross-midnight safe).
 *
 * Also registers ConflictPairV2 entries for each violation so the
 * bidding engine and batch solver can reuse the conflict graph.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { toAbsoluteMinutes, shiftGrossMinutes } from '../windows';

export const R01_no_overlap: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];

    // Use relevant_shifts (impact-scoped) sorted by absolute start time
    const sorted = [...ctx.relevant_shifts].sort((a, b) =>
        toAbsoluteMinutes(a.shift_date, a.start_time)
        - toAbsoluteMinutes(b.shift_date, b.start_time)
    );

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];

        const aStart = toAbsoluteMinutes(a.shift_date, a.start_time);
        const aEnd   = aStart + shiftGrossMinutes(a);
        const bStart = toAbsoluteMinutes(b.shift_date, b.start_time);

        if (bStart < aEnd) {
            hits.push({
                rule_id:  'R01_NO_OVERLAP',
                severity: 'BLOCKING',
                message:
                    `Shift on ${b.shift_date} ${b.start_time}–${b.end_time} `
                    + `overlaps with shift on ${a.shift_date} ${a.start_time}–${a.end_time}.`,
                resolution_hint: 'Remove one of the conflicting shifts or adjust their times.',
                affected_shifts: [a.shift_id, b.shift_id],
            });

            ctx.conflict_pairs.push({
                shift_a:       a.shift_id,
                shift_b:       b.shift_id,
                rule_id:       'R01_NO_OVERLAP',
                conflict_type: 'OVERLAP',
            });
        }
    }

    return hits;
};
