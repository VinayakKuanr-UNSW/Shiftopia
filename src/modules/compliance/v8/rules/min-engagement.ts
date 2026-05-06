import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

/**
 * V8 Rule: Minimum Engagement
 * 
 * EBA Requirements:
 * - Standard: Minimum 3 hours (180 mins)
 * - Sunday/Public Holiday: Minimum 4 hours (240 mins)
 */
export const minEngagementRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        const start = parseISO(`${date}T${s.start_time}`);
        const end = parseISO(`${date}T${s.end_time}`);
        let totalMins = differenceInMinutes(end, start);
        if (totalMins < 0) totalMins += 1440; // Cross-midnight

        const isHoliday = s.is_sunday || s.is_public_holiday;
        const isTraining = s.is_training === true;
        
        let requiredMins = 180; // Standard 3h
        if (isHoliday) {
            requiredMins = 240; // Sun/PH 4h
        } else if (isTraining) {
            requiredMins = 120; // Training 2h
        }

        if (totalMins < requiredMins) {
            violations.push({
                rule_id: 'V8_MIN_ENGAGEMENT',
                rule_name: 'Minimum Engagement',
                status: 'BLOCKING',
                summary: `Shift below minimum engagement (${Math.round(totalMins / 60)}h)`,
                details: `Shift on ${s.date} is only ${totalMins} minutes. The ICC EBA requires a minimum of ${requiredMins / 60} hours for ${isTraining ? 'training' : isHoliday ? 'Sundays/Public Holidays' : 'standard days'}.`,
                affected_shifts: [s.id],
                blocking: true,
                calculation: {
                    duration_minutes: totalMins,
                    required_minutes: requiredMins,
                    is_holiday: !!isHoliday,
                    is_training: !!isTraining
                }
            });
        }
    }

    return violations;
};
