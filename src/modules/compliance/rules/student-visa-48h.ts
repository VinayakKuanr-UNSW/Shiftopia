/**
 * Student Visa 48h Rule - Rolling Fortnight
 * 
 * RULE_ID: STUDENT_VISA_48H
 * LIMIT: 48 hours total in any rolling fortnight (consecutive 2 ISO weeks)
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: false (hard constraint - Australian visa requirement)
 * 
 * Implementation follows the 15-step specification:
 * - Uses ISO week numbering (Monday-based)
 * - Handles year boundaries (W52 → W01)
 * - Splits cross-midnight shifts by day/week
 * - Reports ALL violating fortnights
 * 
 * Edge cases handled:
 * - Partial weeks at year boundaries
 * - Midnight-crossing shifts
 * - Year boundary fortnights (e.g., W52 2026 + W01 2027)
 * - Exactly 48h = PASS, 48.01h = FAIL
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult,
    ShiftTimeRange
} from '../types';
import {
    splitShiftByDay,
    minutesToHours,
    getISOWeekInfoFromString,
    getISOWeekDateRange,
    sortISOWeekKeys,
    formatDateForDisplay
} from '../utils';
import { addDays, subDays, format, parseISO, startOfISOWeek } from 'date-fns';

const FORTNIGHT_LIMIT = 48;

// =============================================================================
// TYPES
// =============================================================================

interface WeekHours {
    key: string;           // e.g., "2026-W42"
    year: number;
    week: number;
    hours: number;
    dateRange: string;     // e.g., "14 Oct - 20 Oct"
}

interface FortnightWindow {
    weekA: string;
    weekB: string;
    hoursA: number;
    hoursB: number;
    totalHours: number;
    status: 'pass' | 'fail';
    dateRange: string;
}

interface ViolationDetail {
    weeks: [string, string];
    weekAHours: number;
    weekBHours: number;
    totalHours: number;
    limit: number;
    dateRange: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate net paid hours for a shift (excluding unpaid breaks)
 */
function getShiftNetMinutes(shift: ShiftTimeRange): number {
    const ranges = splitShiftByDay(shift);
    let totalMinutes = 0;

    for (const range of ranges) {
        totalMinutes += range.end_minutes - range.start_minutes;
    }

    // Subtract unpaid break
    const unpaidBreak = shift.unpaid_break_minutes || 0;
    return Math.max(0, totalMinutes - unpaidBreak);
}

/**
 * Assign shift hours to ISO weeks
 * Cross-midnight shifts are split by day, each day assigned to its ISO week
 */
function assignShiftToWeeks(shift: ShiftTimeRange): Map<string, number> {
    const weekHours = new Map<string, number>();
    const ranges = splitShiftByDay(shift);

    // Calculate total minutes for break distribution
    const totalMinutes = ranges.reduce((sum, r) => sum + (r.end_minutes - r.start_minutes), 0);
    const unpaidBreak = shift.unpaid_break_minutes || 0;

    for (const range of ranges) {
        const weekInfo = getISOWeekInfoFromString(range.shift_date);
        const rangeMinutes = range.end_minutes - range.start_minutes;

        // Distribute break proportionally if cross-midnight
        const proportion = totalMinutes > 0 ? rangeMinutes / totalMinutes : 1;
        const breakForRange = ranges.length > 1 ? unpaidBreak * proportion : unpaidBreak;

        const netMinutes = Math.max(0, rangeMinutes - breakForRange);
        const netHours = minutesToHours(netMinutes);

        const existing = weekHours.get(weekInfo.key) || 0;
        weekHours.set(weekInfo.key, existing + netHours);
    }

    return weekHours;
}

/**
 * Build weekly totals from all shifts
 */
function buildWeeklyTotals(shifts: ShiftTimeRange[]): Map<string, number> {
    const totals = new Map<string, number>();

    for (const shift of shifts) {
        const shiftWeeks = assignShiftToWeeks(shift);
        for (const [weekKey, hours] of shiftWeeks) {
            const existing = totals.get(weekKey) || 0;
            totals.set(weekKey, Math.round((existing + hours) * 100) / 100);
        }
    }

    return totals;
}

/**
 * Get date range string for an ISO week (e.g., "14 Oct - 20 Oct")
 */
function getWeekDateRangeString(weekKey: string): string {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);

    const range = getISOWeekDateRange(year, week);
    const startDay = format(range.start, 'd MMM');
    const endDay = format(range.end, 'd MMM');

    return `${startDay} - ${endDay}`;
}

// =============================================================================
// MAIN RULE
// =============================================================================

export const StudentVisa48hRule: ComplianceRule = {
    id: 'STUDENT_VISA_48H',
    name: 'Student Visa (48h/fortnight)',
    description: 'Student visa holders cannot work more than 48h in any rolling fortnight. Toggle enforcement to make violations blocking.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    // Blocking is determined at runtime from input.student_visa_enforcement
    blocking: false,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const isEnforced = input.student_visa_enforcement ?? false;
        const { candidate_shift, existing_shifts } = input;
        const targetDateStr = candidate_shift.shift_date;
        const targetDate = parseISO(targetDateStr);

        // Step 4: Fetch all shifts within evaluation range
        // Range: 13 days before to 13 days after candidate shift
        const rangeStart = subDays(targetDate, 13);
        const rangeEnd = addDays(targetDate, 13);

        // Filter existing shifts to only those in range
        const relevantExisting = existing_shifts.filter(shift => {
            const shiftDate = parseISO(shift.shift_date);
            return shiftDate >= rangeStart && shiftDate <= rangeEnd;
        });

        // Step 5-7: Build weekly totals (includes candidate shift)
        const allShifts = [...relevantExisting, candidate_shift];
        const weeklyTotals = buildWeeklyTotals(allShifts);

        // Ensure we always have the candidate week and its neighbors (prev, current, next).
        //
        // F8 fix: deriving neighbours by adding ±7 days to the candidate week's Monday
        // and re-parsing via getISOWeekInfoFromString. This is correct for all ISO
        // years including those with 53 weeks (e.g. 2026), where the old arithmetic
        // (week === 52 ? 1 : week + 1) would produce a phantom "W54" key.
        const candidateWeekInfo = getISOWeekInfoFromString(targetDateStr);
        const candidateMonday   = format(startOfISOWeek(targetDate), 'yyyy-MM-dd');

        const prevWeekInfo = getISOWeekInfoFromString(
            format(subDays(parseISO(candidateMonday), 7), 'yyyy-MM-dd')
        );
        const nextWeekInfo = getISOWeekInfoFromString(
            format(addDays(parseISO(candidateMonday), 7), 'yyyy-MM-dd')
        );

        const prevWeekKey = prevWeekInfo.key;
        const currWeekKey = candidateWeekInfo.key;
        const nextWeekKey = nextWeekInfo.key;

        // Add missing weeks with 0 hours
        if (!weeklyTotals.has(prevWeekKey)) weeklyTotals.set(prevWeekKey, 0);
        if (!weeklyTotals.has(currWeekKey)) weeklyTotals.set(currWeekKey, 0);
        if (!weeklyTotals.has(nextWeekKey)) weeklyTotals.set(nextWeekKey, 0);

        // Step 9: Sort weeks chronologically
        const sortedWeekKeys = sortISOWeekKeys([...weeklyTotals.keys()]);

        // Build week info array
        const weeks: WeekHours[] = sortedWeekKeys.map(key => {
            const [yearStr, weekStr] = key.split('-W');
            return {
                key,
                year: parseInt(yearStr, 10),
                week: parseInt(weekStr, 10),
                hours: weeklyTotals.get(key) || 0,
                dateRange: getWeekDateRangeString(key)
            };
        });

        // Step 10-11: Evaluate rolling fortnight windows
        const windows: FortnightWindow[] = [];
        const violations: ViolationDetail[] = [];

        for (let i = 0; i < weeks.length - 1; i++) {
            const weekA = weeks[i];
            const weekB = weeks[i + 1];

            // Check if weeks are consecutive (handles year boundary)
            const isConsecutive =
                (weekA.year === weekB.year && weekB.week === weekA.week + 1) ||
                (weekB.year === weekA.year + 1 && weekB.week === 1 && (weekA.week === 52 || weekA.week === 53));

            if (!isConsecutive) continue;

            const totalHours = Math.round((weekA.hours + weekB.hours) * 100) / 100;
            const status = totalHours > FORTNIGHT_LIMIT ? 'fail' : 'pass';

            const window: FortnightWindow = {
                weekA: weekA.key,
                weekB: weekB.key,
                hoursA: weekA.hours,
                hoursB: weekB.hours,
                totalHours,
                status,
                dateRange: `${weekA.dateRange} to ${weekB.dateRange}`
            };
            windows.push(window);

            // Step 12-13: Track violations
            if (status === 'fail') {
                violations.push({
                    weeks: [weekA.key, weekB.key],
                    weekAHours: weekA.hours,
                    weekBHours: weekB.hours,
                    totalHours,
                    limit: FORTNIGHT_LIMIT,
                    dateRange: window.dateRange
                });
            }
        }

        // Step 14: Determine overall result
        const hasViolation = violations.length > 0;
        const worstViolation = violations.length > 0
            ? violations.reduce((worst, v) => v.totalHours > worst.totalHours ? v : worst, violations[0])
            : null;

        // Find the peak usage (even if passing)
        const peakWindow = windows.length > 0
            ? windows.reduce((peak, w) => w.totalHours > peak.totalHours ? w : peak, windows[0])
            : null;

        const modeLabel = isEnforced ? ' (enforcement ON — blocking)' : ' (toggle OFF — warning only)';

        // Step 15: Build structured result
        const result: ComplianceResult = {
            rule_id: this.id,
            rule_name: this.name,
            status: hasViolation ? 'fail' : 'pass',
            summary: hasViolation
                ? `Exceeds 48h limit: ${worstViolation!.totalHours}h in fortnight (${worstViolation!.weeks.join(' + ')})${modeLabel}`
                : `Within 48h limit (${peakWindow?.totalHours || 0}h peak)`,
            details: hasViolation
                ? `${violations.length} rolling fortnight(s) exceed 48h limit:\n${violations.map(v =>
                    `• ${v.weeks[0]} (${v.weekAHours}h) + ${v.weeks[1]} (${v.weekBHours}h) = ${v.totalHours}h`
                ).join('\n')}`
                : `All rolling fortnights within limit. Peak: ${peakWindow?.totalHours || 0}h (${peakWindow?.weekA || 'N/A'} + ${peakWindow?.weekB || 'N/A'})`,
            calculation: {
                existing_hours: minutesToHours(relevantExisting.reduce((sum, s) => sum + getShiftNetMinutes(s), 0)),
                limit: FORTNIGHT_LIMIT,
                candidate_hours: minutesToHours(getShiftNetMinutes(candidate_shift)),
                total_hours: worstViolation?.totalHours || peakWindow?.totalHours || 0,
                // Weekly breakdown
                weeks: Object.fromEntries(weeks.map(w => [w.key, { hours: w.hours, dates: w.dateRange }])),
                // All evaluated windows
                windows_evaluated: windows.map(w => ({
                    weeks: [w.weekA, w.weekB],
                    hours: w.totalHours,
                    status: w.status
                })),
                // Violation details
                violations: violations.map(v => ({
                    weeks: v.weeks,
                    hours: v.totalHours,
                    breakdown: { [v.weeks[0]]: v.weekAHours, [v.weeks[1]]: v.weekBHours }
                })),
                enforcement_enabled: isEnforced
            },
            // When enforcement toggle is ON, violations are blocking; otherwise they're warnings
            blocking: isEnforced
        };

        return result;
    }
};

export default StudentVisa48hRule;
