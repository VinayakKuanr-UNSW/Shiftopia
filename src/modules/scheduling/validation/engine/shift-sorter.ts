/**
 * ShiftSorter — Sort candidate shifts and provide O(log n) neighbor lookup.
 *
 * Sorting by date + start_time ensures the IncrementalValidator processes
 * shifts in chronological order, which is important for correctness of
 * rest-gap checking in the SimulatedRoster.
 *
 * Binary search is used internally by the incremental validator to quickly
 * locate neighbor shifts when checking rest gaps — O(log n) per lookup vs
 * O(n) for a linear scan.
 */

import type { CandidateShift } from '../types';

// =============================================================================
// UTILS
// =============================================================================

/**
 * Convert shift_date + start_time / end_time to minutes since epoch (approx).
 * Used only for sorting and comparison — not for calendar arithmetic.
 */
function toAbsoluteMinutes(date: string, time: string): number {
    const [year, month, day] = date.split('-').map(Number);
    const [h, m] = time.split(':').map(Number);
    // Days since a fixed epoch (Unix day count) × 1440 + minutes
    const daysSinceEpoch = (year - 1970) * 365 + Math.floor((year - 1970) / 4)
        + [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month - 1] + (day - 1);
    return daysSinceEpoch * 1440 + h * 60 + m;
}

/**
 * Shift start time as absolute minutes since epoch.
 * Handles overnight shifts (end < start → end is next day).
 */
export function shiftStartMinutes(s: CandidateShift): number {
    return toAbsoluteMinutes(s.shift_date, s.start_time);
}

/**
 * Shift end time as absolute minutes since epoch.
 * Overnight shifts cross midnight → end is the next calendar day.
 */
export function shiftEndMinutes(s: CandidateShift): number {
    const startMins = toAbsoluteMinutes(s.shift_date, s.start_time);
    const [endH, endM] = s.end_time.split(':').map(Number);
    const [startH, startM] = s.start_time.split(':').map(Number);
    const startOfDay = startMins - (startH * 60 + startM);
    let endMins = startOfDay + endH * 60 + endM;
    // Overnight: end time is before start time → add one day
    if (endMins <= startMins) {
        endMins += 1440;
    }
    return endMins;
}

// =============================================================================
// SORTER
// =============================================================================

export class ShiftSorter {
    /**
     * Sort candidate shifts chronologically by shift_date + start_time.
     * Returns a NEW sorted array (does not mutate the input).
     */
    sort(shifts: CandidateShift[]): CandidateShift[] {
        return [...shifts].sort((a, b) => {
            const dateCmp = a.shift_date.localeCompare(b.shift_date);
            if (dateCmp !== 0) return dateCmp;
            return a.start_time.localeCompare(b.start_time);
        });
    }

    /**
     * Binary search: find the last shift in `sorted` whose start time is ≤ targetMins.
     * Returns null if all shifts start after targetMins.
     *
     * Precondition: `sorted` is sorted by shiftStartMinutes ascending.
     */
    findPredecessor(sorted: CandidateShift[], targetMins: number): CandidateShift | null {
        let lo = 0;
        let hi = sorted.length - 1;
        let result: CandidateShift | null = null;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const startMins = shiftStartMinutes(sorted[mid]);
            if (startMins <= targetMins) {
                result = sorted[mid];
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result;
    }

    /**
     * Binary search: find the first shift in `sorted` whose start time is ≥ targetMins.
     * Returns null if all shifts start before targetMins.
     */
    findSuccessor(sorted: CandidateShift[], targetMins: number): CandidateShift | null {
        let lo = 0;
        let hi = sorted.length - 1;
        let result: CandidateShift | null = null;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const startMins = shiftStartMinutes(sorted[mid]);
            if (startMins >= targetMins) {
                result = sorted[mid];
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }
        return result;
    }
}

export const shiftSorter = new ShiftSorter();
