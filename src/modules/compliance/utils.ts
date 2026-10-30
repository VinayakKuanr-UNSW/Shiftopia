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



// =============================================================================
// TIMEZONE NORMALIZATION
// =============================================================================


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
function splitShiftByDay(shift: ShiftTimeRange): TimeRangeOnDate[] {
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
 * Check if two time ranges overlap
 */
function doRangesOverlap(a: TimeRangeOnDate, b: TimeRangeOnDate): boolean {
    if (a.shift_date !== b.shift_date) return false;
    return a.start_minutes < b.end_minutes && b.start_minutes < a.end_minutes;
}

// =============================================================================
// NET DURATION CALCULATIONS
// =============================================================================





// =============================================================================
// DATE HELPERS
// =============================================================================

/**
 * Get next date in YYYY-MM-DD format
 */
function getNextDate(dateStr: string): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
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









