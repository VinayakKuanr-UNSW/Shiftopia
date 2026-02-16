/**
 * Compliance Engine - Utility Functions
 * 
 * Critical utility functions for time calculations.
 * Handles:
 * - Cross-midnight shifts (split by day)
 * - Overlapping shift deduplication
 * - Net duration calculations
 * - Timezone normalization
 */

import { ShiftTimeRange } from './types';
import { getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek, addWeeks, format, parseISO } from 'date-fns';

// =============================================================================
// TIME PARSING
// =============================================================================

/**
 * Parse HH:mm time string to minutes since midnight
 */
export function parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + (minutes || 0);
}

/**
 * Convert minutes to hours (decimal, 2 decimals)
 */
export function minutesToHours(minutes: number): number {
    return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Format minutes as HH:mm string
 */
export function minutesToTimeString(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// =============================================================================
// TIMEZONE NORMALIZATION
// =============================================================================

/**
 * Normalize a shift to the organization's timezone.
 * For now, we assume all times are in local org timezone.
 * 
 * In production, this would:
 * 1. Parse the shift's timezone
 * 2. Convert to org's reference timezone
 * 3. Return normalized times
 */
export function normalizeToOrgTimezone(
    shift: ShiftTimeRange,
    _orgTimezone: string = 'Australia/Sydney'
): ShiftTimeRange {
    // Currently pass-through since we assume consistent timezone
    // This is the hook point for multi-timezone support
    return shift;
}

// =============================================================================
// CROSS-MIDNIGHT HANDLING
// =============================================================================

interface TimeRangeOnDate {
    start_minutes: number;  // Minutes since midnight
    end_minutes: number;    // May exceed 1440 for cross-midnight
    shift_date: string;
}

/**
 * Split a shift into per-day ranges.
 * 
 * Example: 22:00-06:00 on 2026-01-20 becomes:
 * - [{ shift_date: '2026-01-20', start: 1320, end: 1440 }]  // 22:00-00:00
 * - [{ shift_date: '2026-01-21', start: 0, end: 360 }]      // 00:00-06:00
 */
export function splitShiftByDay(shift: ShiftTimeRange): TimeRangeOnDate[] {
    const start = parseTimeToMinutes(shift.start_time);
    const end = parseTimeToMinutes(shift.end_time);
    const isCrossMidnight = end <= start;

    if (!isCrossMidnight) {
        // Normal shift: all on one day
        return [{
            shift_date: shift.shift_date,
            start_minutes: start,
            end_minutes: end
        }];
    }

    // Cross-midnight: split into two ranges
    const nextDate = getNextDate(shift.shift_date);
    return [
        {
            shift_date: shift.shift_date,
            start_minutes: start,
            end_minutes: 24 * 60  // Midnight
        },
        {
            shift_date: nextDate,
            start_minutes: 0,
            end_minutes: end
        }
    ];
}

// =============================================================================
// OVERLAP DETECTION & MERGING
// =============================================================================

/**
 * Merge overlapping time ranges to avoid double-counting hours.
 * Input ranges must be for the same date and sorted by start time.
 * 
 * Example: 
 * - Range A: 08:00-12:00
 * - Range B: 10:00-14:00
 * - Merged: 08:00-14:00 (6 hours, not 4+4=8)
 */
export function mergeOverlappingRanges(ranges: TimeRangeOnDate[]): TimeRangeOnDate[] {
    if (ranges.length <= 1) return ranges;

    // Sort by start time
    const sorted = [...ranges].sort((a, b) => a.start_minutes - b.start_minutes);
    const merged: TimeRangeOnDate[] = [];
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];

        if (next.start_minutes <= current.end_minutes) {
            // Overlapping: extend current range
            current.end_minutes = Math.max(current.end_minutes, next.end_minutes);
        } else {
            // No overlap: push current and start new
            merged.push(current);
            current = { ...next };
        }
    }

    merged.push(current);
    return merged;
}

/**
 * Check if two time ranges overlap
 */
export function doRangesOverlap(a: TimeRangeOnDate, b: TimeRangeOnDate): boolean {
    if (a.shift_date !== b.shift_date) return false;
    return a.start_minutes < b.end_minutes && b.start_minutes < a.end_minutes;
}

// =============================================================================
// NET DURATION CALCULATIONS
// =============================================================================

/**
 * Calculate net working hours for a date from multiple shifts.
 * Handles overlaps correctly by merging ranges first.
 */
export function calculateNetHoursForDate(
    shifts: ShiftTimeRange[],
    targetDate: string
): number {
    // Normalize all shifts (timezone hook)
    const normalized = shifts.map(s => normalizeToOrgTimezone(s));

    // Split cross-midnight shifts and filter to target date
    const rangesForDate: TimeRangeOnDate[] = [];

    for (const shift of normalized) {
        const splitRanges = splitShiftByDay(shift);
        for (const range of splitRanges) {
            if (range.shift_date === targetDate) {
                rangesForDate.push(range);
            }
        }
    }

    if (rangesForDate.length === 0) return 0;

    // Merge overlapping ranges to avoid double-counting
    const merged = mergeOverlappingRanges(rangesForDate);

    // Sum durations (Gross Hours)
    const grossMinutes = merged.reduce((sum, range) => {
        return sum + (range.end_minutes - range.start_minutes);
    }, 0);

    // Calculate sum of unpaid breaks for valid shifts on this date
    // We only deduct the break if the shift effectively belongs to this date.
    // getShiftHoursForDate attributes break to the primary date.
    let totalUnpaidBreakMinutes = 0;

    // Iterate through original shifts to find relevant breaks
    for (const shift of shifts) {
        // If the shift starts on this date, we deduct its break
        // This aligns with getShiftHoursForDate logic
        if (shift.shift_date === targetDate) {
            totalUnpaidBreakMinutes += (shift.unpaid_break_minutes || 0);
        }
    }

    const netMinutes = Math.max(0, grossMinutes - totalUnpaidBreakMinutes);

    return minutesToHours(netMinutes);
}

/**
 * Get total shift duration in minutes (for a single shift)
 */
export function getShiftDurationMinutes(startTime: string, endTime: string): number {
    const start = parseTimeToMinutes(startTime);
    let end = parseTimeToMinutes(endTime);

    if (end <= start) {
        end += 24 * 60;  // Cross-midnight
    }

    return end - start;
}

/**
 * Calculate NET hours of a shift for a specific date (subtracts unpaid breaks)
 */
export function getShiftHoursForDate(
    shift: ShiftTimeRange,
    targetDate: string
): number {
    const ranges = splitShiftByDay(shift);
    const rangeForDate = ranges.find(r => r.shift_date === targetDate);

    if (!rangeForDate) return 0;

    const grossMinutes = rangeForDate.end_minutes - rangeForDate.start_minutes;

    // Subtract unpaid break if provided (only for the primary date, not split portions)
    // For cross-midnight shifts, we apply break deduction proportionally to the primary date portion
    let breakMinutes = shift.unpaid_break_minutes || 0;

    // If this is a cross-midnight shift and this is the secondary date portion,
    // don't apply the break deduction (it's applied to the primary portion)
    if (ranges.length > 1 && rangeForDate.shift_date !== shift.shift_date) {
        breakMinutes = 0;
    }

    const netMinutes = Math.max(0, grossMinutes - breakMinutes);
    return minutesToHours(netMinutes);
}

/**
 * Calculate total hours for a date from multiple shifts (with overlap handling)
 */
export function getTotalHoursForDate(
    shifts: ShiftTimeRange[],
    targetDate: string
): number {
    return calculateNetHoursForDate(shifts, targetDate);
}

// =============================================================================
// DATE HELPERS
// =============================================================================

/**
 * Get next date in YYYY-MM-DD format
 */
export function getNextDate(dateStr: string): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
}

/**
 * Get previous date in YYYY-MM-DD format
 */
export function getPreviousDate(dateStr: string): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

/**
 * Format date for display
 */
export function formatDateForDisplay(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// =============================================================================
// SHIFT OVERLAP DETECTION (for UI warnings)
// =============================================================================

/**
 * Check if two shifts overlap (same date, overlapping times)
 */
export function doShiftsOverlap(shift1: ShiftTimeRange, shift2: ShiftTimeRange): boolean {
    const ranges1 = splitShiftByDay(shift1);
    const ranges2 = splitShiftByDay(shift2);

    for (const r1 of ranges1) {
        for (const r2 of ranges2) {
            if (doRangesOverlap(r1, r2)) {
                return true;
            }
        }
    }

    return false;
}

// =============================================================================
// ISO WEEK UTILITIES (for Student Visa rolling fortnight)
// =============================================================================

export interface ISOWeekInfo {
    year: number;       // ISO week year (may differ from calendar year at boundaries)
    week: number;       // ISO week number (1-53)
    key: string;        // Sortable key like "2026-W42"
}

/**
 * Get ISO week info for a date.
 * Uses ISO 8601: week starts Monday, week 1 is the first week with ≥4 days in new year.
 */
export function getISOWeekInfo(date: Date): ISOWeekInfo {
    const week = getISOWeek(date);
    const year = getISOWeekYear(date);
    const key = `${year}-W${week.toString().padStart(2, '0')}`;
    return { year, week, key };
}

/**
 * Get ISO week info from a date string (YYYY-MM-DD)
 */
export function getISOWeekInfoFromString(dateStr: string): ISOWeekInfo {
    const date = parseISO(dateStr);
    return getISOWeekInfo(date);
}

/**
 * Get the Monday (start) and Sunday (end) dates for an ISO week
 */
export function getISOWeekDateRange(year: number, week: number): { start: Date; end: Date; startStr: string; endStr: string } {
    // Start from Jan 4 of the year (always in week 1) and navigate to target week
    const jan4 = new Date(year, 0, 4);
    const week1Start = startOfISOWeek(jan4);
    const targetWeekStart = addWeeks(week1Start, week - 1);
    const targetWeekEnd = endOfISOWeek(targetWeekStart);

    return {
        start: targetWeekStart,
        end: targetWeekEnd,
        startStr: format(targetWeekStart, 'yyyy-MM-dd'),
        endStr: format(targetWeekEnd, 'yyyy-MM-dd')
    };
}

/**
 * Get all ISO weeks that a date range spans
 */
export function getISOWeeksInRange(startDate: Date, endDate: Date): ISOWeekInfo[] {
    const weeks: ISOWeekInfo[] = [];
    const seenKeys = new Set<string>();

    let current = new Date(startDate);
    while (current <= endDate) {
        const info = getISOWeekInfo(current);
        if (!seenKeys.has(info.key)) {
            seenKeys.add(info.key);
            weeks.push(info);
        }
        // Move to next day
        current.setDate(current.getDate() + 1);
    }

    return weeks;
}

/**
 * Sort ISO week keys chronologically (handles year boundaries)
 * e.g., "2026-W52" < "2027-W01"
 */
export function sortISOWeekKeys(keys: string[]): string[] {
    return [...keys].sort((a, b) => {
        const [yearA, weekA] = a.split('-W').map(Number);
        const [yearB, weekB] = b.split('-W').map(Number);
        if (yearA !== yearB) return yearA - yearB;
        return weekA - weekB;
    });
}

/**
 * Check if two ISO week keys are consecutive (handles year boundary)
 */
export function areWeeksConsecutive(keyA: string, keyB: string): boolean {
    const [yearA, weekA] = keyA.split('-W').map(Number);
    const [yearB, weekB] = keyB.split('-W').map(Number);

    // Same year, consecutive weeks
    if (yearA === yearB && weekB === weekA + 1) return true;

    // Year boundary: W52/W53 -> W01
    if (yearB === yearA + 1 && weekB === 1 && (weekA === 52 || weekA === 53)) {
        return true;
    }

    return false;
}

/**
 * Get date range string for an ISO week (e.g., "14 Oct - 20 Oct")
 */
export function getWeekDateRangeString(weekKey: string): string {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);

    const range = getISOWeekDateRange(year, week);
    const startDay = format(range.start, 'd MMM');
    const endDay = format(range.end, 'd MMM');

    return `${startDay} - ${endDay}`;
}

