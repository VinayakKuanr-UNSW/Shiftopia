/**
 * Ordinary Hours Averaging Rule
 *
 * RULE_ID: AVG_FOUR_WEEK_CYCLE
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * Employees must average 38 hours per week (User Story 9).
 * Maximum allowed hours depends on the averaging cycle:
 *   1 week  =  38 hours
 *   2 weeks =  76 hours
 *   3 weeks = 114 hours
 *   4 weeks = 152 hours (default)
 *
 * The cycle is set via input.averaging_cycle_weeks (default 4).
 * A rolling window of (cycle_weeks × 7) days ending on the candidate shift date is used.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { parseISO, subDays, isWithinInterval, differenceInMinutes } from 'date-fns';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

// F9: org_timezone default — rules import SYDNEY_TZ as the fallback so
// existing callers that don't pass org_timezone are unaffected.

const WEEKLY_LIMIT_HOURS = 38;

interface CycleData {
    weeks: number;
    total_hours: number;
    limit: number;
    average_weekly_hours: number;
    status: 'pass' | 'fail';
}

function getShiftMinutes(
    s: { shift_date: string; start_time: string; end_time: string; unpaid_break_minutes?: number },
    tz: string = SYDNEY_TZ
): number {
    const start = parseZonedDateTime(s.shift_date, s.start_time, tz);
    const end = parseZonedDateTime(s.shift_date, s.end_time, tz);
    let mins = differenceInMinutes(end, start);
    if (mins < 0) mins += 1440;
    return Math.max(0, mins - (s.unpaid_break_minutes || 0));
}

export const AvgFourWeekCycleRule: ComplianceRule = {
    id: 'AVG_FOUR_WEEK_CYCLE',
    name: 'Ordinary Hours Averaging',
    description: 'Employees must average 38h/week. Default cycle: 4 weeks (152h max). Configurable via averaging_cycle_weeks.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'pass',
                summary: 'Shift is unassigned',
                details: 'Compliance checks skipped for unassigned shift',
                calculation: {
                    existing_hours: 0,
                    candidate_hours: 0,
                    total_hours: 0,
                    limit: 152,
                    average_weekly_hours: 0,
                    cycle_weeks: 4,
                    weekly_limit: WEEKLY_LIMIT_HOURS
                },
                blocking: false
            };
        }

        const { candidate_shift, existing_shifts } = input;
        // F9: use org_timezone from input, fall back to Sydney for backward compatibility
        const tz = input.org_timezone ?? SYDNEY_TZ;
        const cycleWeeks: 1 | 2 | 3 | 4 = input.averaging_cycle_weeks ?? 4;
        const cycleDays = cycleWeeks * 7;
        const cycleLimit = cycleWeeks * WEEKLY_LIMIT_HOURS;

        const shiftDate = parseISO(candidate_shift.shift_date);
        const windowStart = subDays(shiftDate, cycleDays - 1);
        const windowEnd = shiftDate;

        let totalMinutes = 0;

        // Candidate shift
        const candidateMinutes = getShiftMinutes(candidate_shift, tz);
        totalMinutes += candidateMinutes;

        // Existing shifts within the window
        existing_shifts.forEach(shift => {
            const sDate = parseISO(shift.shift_date);
            if (isWithinInterval(sDate, { start: windowStart, end: windowEnd })) {
                totalMinutes += getShiftMinutes(shift, tz);
            }
        });

        const totalHours = totalMinutes / 60;
        const existingHours = (totalMinutes - candidateMinutes) / 60;
        const candidateHours = candidateMinutes / 60;
        const averageWeeklyHours = totalHours / cycleWeeks;

        const cycleLabel = cycleWeeks === 1 ? '1-week' : `${cycleWeeks}-week`;

        // Compute all 4 cycle windows for visualization
        const allCycles: CycleData[] = ([1, 2, 3, 4] as const).map(wks => {
            const wDays = wks * 7;
            const wStart = subDays(shiftDate, wDays - 1);
            let wMins = candidateMinutes;
            existing_shifts.forEach(shift => {
                const sDate = parseISO(shift.shift_date);
                if (isWithinInterval(sDate, { start: wStart, end: windowEnd })) {
                    wMins += getShiftMinutes(shift, tz);
                }
            });
            const wHours = wMins / 60;
            const wLimit = wks * WEEKLY_LIMIT_HOURS;
            return {
                weeks: wks,
                total_hours: parseFloat(wHours.toFixed(1)),
                limit: wLimit,
                average_weekly_hours: parseFloat((wHours / wks).toFixed(1)),
                status: wHours > wLimit ? 'fail' : 'pass',
            };
        });

        if (totalHours > cycleLimit) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'fail',
                summary: `Exceeds ${cycleLimit}h in ${cycleLabel} cycle (${totalHours.toFixed(1)}h / avg ${averageWeeklyHours.toFixed(1)}h/wk)`,
                details: `Total hours in rolling ${cycleLabel} period: ${totalHours.toFixed(1)}h. Limit is ${cycleLimit}h (${WEEKLY_LIMIT_HOURS}h/wk avg).`,
                calculation: {
                    existing_hours: existingHours,
                    candidate_hours: candidateHours,
                    total_hours: totalHours,
                    limit: cycleLimit,
                    average_weekly_hours: averageWeeklyHours,
                    cycle_weeks: cycleWeeks,
                    weekly_limit: WEEKLY_LIMIT_HOURS,
                    all_cycles: allCycles,
                },
                blocking: this.blocking
            };
        }

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: 'pass',
            summary: `Within ${cycleLimit}h/${cycleLabel} limit (${totalHours.toFixed(1)}h / avg ${averageWeeklyHours.toFixed(1)}h/wk)`,
            details: `Rolling ${cycleLabel} total: ${totalHours.toFixed(1)}h / ${cycleLimit}h (avg ${averageWeeklyHours.toFixed(1)}h/wk)`,
            calculation: {
                existing_hours: existingHours,
                candidate_hours: candidateHours,
                total_hours: totalHours,
                limit: cycleLimit,
                average_weekly_hours: averageWeeklyHours,
                cycle_weeks: cycleWeeks,
                weekly_limit: WEEKLY_LIMIT_HOURS,
                all_cycles: allCycles,
            },
            blocking: this.blocking
        };
    }
};
