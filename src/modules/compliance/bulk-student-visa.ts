/**
 * Bulk-Optimized Student Visa Compliance
 * 
 * Performance: O(n) per employee
 * - Aggregates all shifts into weekly totals ONCE
 * - Scans rolling 2-week windows ONCE
 * - Attributes violations to all contributing shifts
 */

import { parseISO, addDays, format, subDays } from 'date-fns';
import {
    splitShiftByDay,
    minutesToHours,
    getISOWeekInfoFromString,
    getWeekDateRangeString,
    sortISOWeekKeys,
    areWeeksConsecutive
} from './utils';
import { ShiftForRestGap } from './bulk-rest-gap';

// =============================================================================
// CONSTANTS
// =============================================================================

const FORTNIGHT_LIMIT = 48;

// =============================================================================
// TYPES
// =============================================================================

// Re-use the shift interface from rest gap as it has all needing fields
export type ShiftForVisa = ShiftForRestGap & { unpaid_break_minutes?: number };

export interface StudentVisaViolation {
    weeks: [string, string];        // ["2026-W01", "2026-W02"]
    totalHours: number;             // Combined hours
    limit: number;                  // 48
    breakdown: Record<string, number>; // { "2026-W01": 20, "2026-W02": 30 }
    dateRange: string;              // "30 Dec - 12 Jan"
}

export interface BulkStudentVisaResult {
    violations: StudentVisaViolation[];
    perShiftViolations: Map<string, StudentVisaViolation[]>;
    // Cached weekly data for visualization
    weeklyData: Map<string, {
        hours: number;
        dateRange: string;
    }>;
    // Window analysis for each shift (peak usage etc)
    shiftWindowCheck: Map<string, {
        peakHours: number;
        worstViolation: StudentVisaViolation | null;
    }>;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Compute student visa violations for all shifts in O(n) time.
 */
export function checkBulkStudentVisa(
    existingShifts: ShiftForVisa[],
    candidateShifts: ShiftForVisa[]
): BulkStudentVisaResult {
    const violations: StudentVisaViolation[] = [];
    const perShiftViolations = new Map<string, StudentVisaViolation[]>();
    const weeklyData = new Map<string, { hours: number; dateRange: string }>();
    const shiftWindowCheck = new Map<string, { peakHours: number; worstViolation: StudentVisaViolation | null }>();

    // Combine all shifts
    const allShifts = [...existingShifts, ...candidateShifts];

    // Map shift IDs to the weeks they contribute to
    const shiftWeeksMap = new Map<string, Set<string>>();

    // Phase 1: Aggregate Weekly Hours
    for (const shift of allShifts) {
        // Split by day
        const ranges = splitShiftByDay({
            start_time: shift.start_time,
            end_time: shift.end_time,
            shift_date: shift.shift_date
        });

        // Calculate total minutes for break distribution
        const totalMinutes = ranges.reduce((sum, r) => sum + (r.end_minutes - r.start_minutes), 0);
        const unpaidBreak = shift.unpaid_break_minutes || 0;

        const weeksForShift = new Set<string>();

        // Distribute hours to weeks
        for (const range of ranges) {
            const weekInfo = getISOWeekInfoFromString(range.shift_date);
            const rangeMinutes = range.end_minutes - range.start_minutes;

            // Distribute break proportionally
            const proportion = totalMinutes > 0 ? rangeMinutes / totalMinutes : 1;
            const breakForRange = ranges.length > 1 ? unpaidBreak * proportion : unpaidBreak;

            const netMinutes = Math.max(0, rangeMinutes - breakForRange);
            const netHours = minutesToHours(netMinutes);

            if (netHours > 0) {
                // Update weekly total
                const existing = weeklyData.get(weekInfo.key) || {
                    hours: 0,
                    dateRange: getWeekDateRangeString(weekInfo.key)
                };
                existing.hours += netHours;
                weeklyData.set(weekInfo.key, existing);

                weeksForShift.add(weekInfo.key);
            }
        }

        shiftWeeksMap.set(shift.id, weeksForShift);
    }

    // Phase 2: Rolling Window Scan using Valid Weeks
    // Get all sorted week keys
    const sortedWeeks = sortISOWeekKeys(Array.from(weeklyData.keys()));

    // Track violations by week key to easily map back to shifts
    const violationsByWeek = new Map<string, StudentVisaViolation[]>();

    for (let i = 0; i < sortedWeeks.length - 1; i++) {
        const weekA = sortedWeeks[i];
        const weekB = sortedWeeks[i + 1];

        if (!areWeeksConsecutive(weekA, weekB)) continue;

        const dataA = weeklyData.get(weekA)!;
        const dataB = weeklyData.get(weekB)!;

        const totalHours = Math.round((dataA.hours + dataB.hours) * 100) / 100;

        if (totalHours > FORTNIGHT_LIMIT) {
            const violation: StudentVisaViolation = {
                weeks: [weekA, weekB],
                totalHours,
                limit: FORTNIGHT_LIMIT,
                breakdown: {
                    [weekA]: dataA.hours,
                    [weekB]: dataB.hours
                },
                dateRange: `${dataA.dateRange.split(' - ')[0]} - ${dataB.dateRange.split(' - ')[1]}`
            };

            violations.push(violation);

            // Map violation to weeks A and B
            addViolationToWeek(violationsByWeek, weekA, violation);
            addViolationToWeek(violationsByWeek, weekB, violation);
        }
    }

    // Phase 3: Attribute Violations to Shifts
    // For each candidate shift, find max violation and peak usage
    for (const shift of candidateShifts) {
        const weeks = shiftWeeksMap.get(shift.id);
        if (!weeks) continue;

        let worstViolation: StudentVisaViolation | null = null;
        let peakHours = 0;
        const shiftViolations: StudentVisaViolation[] = [];

        // Check each week this shift touches
        for (const week of weeks) {
            // Check violations involving this week
            const weekViolations = violationsByWeek.get(week) || [];

            for (const v of weekViolations) {
                // Avoid duplicates
                if (!shiftViolations.includes(v)) {
                    shiftViolations.push(v);
                    if (!worstViolation || v.totalHours > worstViolation.totalHours) {
                        worstViolation = v;
                    }
                }
            }

            // Also calculate peak hours (scan windows involving this week)
            // Look at [Prev+Curr] and [Curr+Next]
            // We can approximate this by looking at all windows derived in Phase 2
            // But faster to just iterate sortedWeeks for this specific check if needed
            // For now, let's just use the violations scan logic which is O(1) here since we already have map
        }

        // Find peak non-violation usage too? 
        // Iterate sorted weeks window array? No, simpler:
        // Already built windows in Phase 2? No, we only kept violations.
        // Let's just store per-shift violations for now.
        // Calculating peak hours for non-violation is good for UX "32h/48h"

        // Quick scan for peak usage involving this shift's weeks
        for (let i = 0; i < sortedWeeks.length - 1; i++) {
            const weekA = sortedWeeks[i];
            const weekB = sortedWeeks[i + 1];

            if (!areWeeksConsecutive(weekA, weekB)) continue;

            // If this shift is in either week
            if (weeks.has(weekA) || weeks.has(weekB)) {
                const h = (weeklyData.get(weekA)?.hours || 0) + (weeklyData.get(weekB)?.hours || 0);
                peakHours = Math.max(peakHours, h);
            }
        }

        perShiftViolations.set(shift.id, shiftViolations);
        shiftWindowCheck.set(shift.id, { peakHours, worstViolation });
    }

    return { violations, perShiftViolations, weeklyData, shiftWindowCheck };
}

function addViolationToWeek(map: Map<string, StudentVisaViolation[]>, week: string, v: StudentVisaViolation) {
    const arr = map.get(week) || [];
    arr.push(v);
    map.set(week, arr);
}
