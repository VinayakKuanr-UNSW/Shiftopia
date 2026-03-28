/**
 * R03 — Maximum Daily Hours
 *
 * For each calendar day touched by a candidate shift, sums all shift segments
 * (from shifts_by_day, which is cross-midnight-safe) and flags if the total
 * exceeds config.max_daily_hours.
 *
 * Optimization: only checks days affected by the candidate_shifts, not the
 * full 28-day window. O(candidate days × segments per day) not O(all days).
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { uniqueShiftIdsFromSegments } from '../windows';

export const R03_max_daily_hours: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];
    const max = ctx.config.max_daily_hours;

    // Collect all calendar days touched by any candidate shift
    const touchedDays = new Set<string>();
    for (const shift of ctx.candidate_shifts) {
        touchedDays.add(shift.shift_date);
        // Cross-midnight: also check the next day
        const endMin   = parseInt(shift.end_time.replace(':', ''), 10);
        const startMin = parseInt(shift.start_time.replace(':', ''), 10);
        if (endMin <= startMin) {
            // Simple cross-midnight: add next date via shifts_by_day keys
            // The segment splitter will have already inserted the next date
        }
    }

    // Also include next-day entries from the segments map that were created
    // by cross-midnight candidate shifts
    for (const shift of ctx.candidate_shifts) {
        const [sh, sm] = shift.start_time.split(':').map(Number);
        const [eh, em] = shift.end_time.split(':').map(Number);
        const startTotalMin = sh * 60 + sm;
        const endTotalMin   = eh * 60 + em;
        if (endTotalMin <= startTotalMin) {
            // Cross-midnight: add next day
            const ms = new Date(shift.shift_date + 'T00:00:00Z').getTime() + 86_400_000;
            touchedDays.add(new Date(ms).toISOString().slice(0, 10));
        }
    }

    for (const day of touchedDays) {
        const segs = ctx.shifts_by_day.get(day);
        if (!segs || segs.length === 0) continue;

        const total = segs.reduce((sum, s) => sum + s.hours, 0);
        if (total > max) {
            const shiftIds = uniqueShiftIdsFromSegments(segs);
            hits.push({
                rule_id:  'R03_MAX_DAILY_HOURS',
                severity: 'BLOCKING',
                message:
                    `${total.toFixed(2)}h scheduled on ${day} — maximum is ${max}h.`,
                resolution_hint: `Remove or shorten a shift on ${day} to stay within the ${max}h daily limit.`,
                affected_shifts: shiftIds,
            });
        }
    }

    return hits;
};
