import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Minimum Engagement
 *
 * The single source of truth for minimum shift duration. (Formerly split
 * across this rule and the redundant `minShiftLengthRule` / R02 — collapsed
 * into one so a too-short shift surfaces as a single blocker.)
 *
 * EBA Requirements (mirrors the form's `minShiftHours`):
 * - Training:               Minimum 2 hours (120 mins) — takes precedence
 * - Standard weekday:       Minimum 3 hours (180 mins)
 * - Sunday/Public Holiday:  Minimum 4 hours (240 mins)
 *
 * Precedence: the training exemption wins over the Sunday/PH uplift so the
 * engine agrees with the UI (training shifts are 2h regardless of the day).
 */
export const minEngagementRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        // Only validate shifts being added/changed — never re-flag the
        // employee's pre-existing (committed) shifts, which are present only
        // for cumulative context and arrive without their training flag.
        if (s.is_candidate === false) continue;

        const start = parseTimeToMinutes(s.start_time);
        let end = parseTimeToMinutes(s.end_time);
        if (end <= start) end += 1440; // Cross-midnight

        const totalMins = end - start;

        const isTraining = s.is_training === true;
        const isHoliday = !!(s.is_sunday || s.is_public_holiday);

        let requiredMins: number;
        let reason: string;
        if (isTraining) {
            requiredMins = 120; // Training 2h (overrides the Sunday/PH uplift)
            reason = 'training shifts';
        } else if (isHoliday) {
            requiredMins = 240; // Sun/PH 4h
            reason = 'Sundays/Public Holidays';
        } else {
            requiredMins = 180; // Standard weekday 3h
            reason = 'standard days';
        }

        if (totalMins < requiredMins) {
            violations.push({
                rule_id: 'V8_MIN_ENGAGEMENT',
                rule_name: 'Minimum Engagement',
                status: 'BLOCKING',
                summary: `Shift below minimum engagement (${Math.round(totalMins / 60)}h)`,
                details: `Shift on ${s.date} is only ${totalMins} minutes. The ICC EBA requires a minimum of ${requiredMins / 60} hours for ${reason}.`,
                affected_shifts: [s.id],
                blocking: true,
                calculation: {
                    duration_minutes: totalMins,
                    required_minutes: requiredMins,
                    is_holiday: isHoliday,
                    is_training: isTraining
                }
            });
        }
    }

    return violations;
};
