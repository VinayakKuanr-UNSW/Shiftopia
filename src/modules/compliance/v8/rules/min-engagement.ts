import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { shiftDurationMinutes } from '../utils/time';

/** Day-type inputs the EBA minimum-engagement tiers key off. */
export interface MinEngagementThresholdInput {
    isTraining?: boolean;
    isSunday?: boolean;
    isPublicHoliday?: boolean;
}

export interface MinEngagementThreshold {
    requiredMins: number;
    reason: string;
}

/**
 * The single source of truth for the EBA minimum-engagement tier table
 * (mirrors the form's `minShiftHours`). Shared by the scheduling-time
 * {@link minEngagementRule} below AND the timesheets billable-floor
 * (`src/modules/timesheets/domain/billable-time.ts`'s `applyMinEngagementFloor`)
 * so the numbers and precedence can never drift between the two enforcement
 * points.
 *
 * - Training:               Minimum 2 hours (120 mins) — takes precedence
 * - Standard weekday:       Minimum 3 hours (180 mins)
 * - Sunday/Public Holiday:  Minimum 4 hours (240 mins)
 *
 * Precedence: the training exemption wins over the Sunday/PH uplift (training
 * shifts are 2h regardless of the day).
 */
export function requiredMinEngagementMinutes(input: MinEngagementThresholdInput): MinEngagementThreshold {
    if (input.isTraining) {
        return { requiredMins: 120, reason: 'training shifts' };
    }
    if (input.isSunday || input.isPublicHoliday) {
        return { requiredMins: 240, reason: 'Sundays/Public Holidays' };
    }
    return { requiredMins: 180, reason: 'standard days' };
}

/**
 * V8 Rule: Minimum Engagement
 *
 * The single source of truth for minimum shift duration. (Formerly split
 * across this rule and the redundant `minShiftLengthRule` / R02 — collapsed
 * into one so a too-short shift surfaces as a single blocker.)
 */
export const minEngagementRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        // Only validate shifts being added/changed — never re-flag the
        // employee's pre-existing (committed) shifts, which are present only
        // for cumulative context and arrive without their training flag.
        if (s.is_candidate === false) continue;

        const totalMins = shiftDurationMinutes(s.start_time, s.end_time);

        const isTraining = s.is_training === true;
        const isHoliday = !!(s.is_sunday || s.is_public_holiday);

        const { requiredMins, reason } = requiredMinEngagementMinutes({
            isTraining,
            isSunday: s.is_sunday,
            isPublicHoliday: s.is_public_holiday,
        });

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
