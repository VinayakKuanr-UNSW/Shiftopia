import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { shiftDurationMinutes } from '../utils/time';

/**
 * V8 Rule: Rest Pauses (cl 37)
 *
 * A paid 15-minute rest pause is due after 4 consecutive ordinary hours
 * worked (cl 37.1), and a SECOND paid 15-minute pause after 8 consecutive
 * ordinary hours excluding the meal break (cl 37.2). The two may be
 * combined into one 30-minute pause by agreement, but a combined pause
 * must not adjoin the meal break (cl 37.3). Audit H-3: no rule for this
 * clause existed at all prior to this file.
 *
 * Unlike the meal break (cl 36), which reduces the shift's net length and
 * is therefore visible via `unpaid_break_minutes`, a rest pause is PAID
 * time within the shift and has no dedicated data field anywhere in this
 * system — there is nothing to check "was it actually taken" against. This
 * rule is necessarily advisory rather than a hard detector: it flags
 * shifts LONG ENOUGH to owe a rest pause, as a reminder to schedule/confirm
 * one, at the same honesty level as mealBreakRule's own
 * unpaid_break_minutes proxy.
 */
export const restPauseRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const hits: V8Hit[] = [];

    for (const s of shifts) {
        // Per-shift check — only the shift(s) being added/changed, not the
        // employee's committed history (see V8Shift.is_candidate).
        if (s.is_candidate === false) continue;

        const totalMins = shiftDurationMinutes(s.start_time, s.end_time);

        if (totalMins >= 240) {
            hits.push({
                rule_id: 'V8_REST_PAUSE',
                rule_name: 'Rest Pause Requirement',
                status: 'WARNING',
                summary: 'Paid rest pause due (cl 37.1)',
                details: `Shift on ${s.date} is ${(totalMins / 60).toFixed(1)}h — a paid 15-minute rest pause is due after 4 consecutive ordinary hours worked (cl 37.1). Confirm it is taken during the shift.`,
                affected_shifts: [s.id],
                blocking: false,
                calculation: { duration_minutes: totalMins, threshold_minutes: 240 },
            });
        }

        if (totalMins >= 480) {
            hits.push({
                rule_id: 'V8_REST_PAUSE',
                rule_name: 'Rest Pause Requirement',
                status: 'WARNING',
                summary: 'Second paid rest pause due (cl 37.2)',
                details: `Shift on ${s.date} is ${(totalMins / 60).toFixed(1)}h — a SECOND paid 15-minute rest pause is due after 8 consecutive ordinary hours, excluding the meal break (cl 37.2). The two pauses may be combined into a single 30-minute pause by agreement, but a combined pause must not adjoin the meal break (cl 37.3).`,
                affected_shifts: [s.id],
                blocking: false,
                calculation: { duration_minutes: totalMins, threshold_minutes: 480 },
            });
        }
    }

    return hits;
};
