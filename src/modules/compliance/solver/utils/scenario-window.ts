/**
 * ScenarioWindow — Scenario Date Range Utility
 *
 * All compliance constraints operate within a bounded time range.
 * The maximum window any constraint needs is ±28 days (WorkingDaysCap, AvgFourWeek).
 *
 * Window map by rule:
 *   Rest Gap         ±1 day
 *   Max Daily Hours  same day
 *   Student Visa     ±14 days
 *   Working Days Cap ±28 days   ← maximum
 *   4 Week Average   ±28 days   ← maximum
 *   Split Shift      same day
 *   No Overlap       same day
 *   Min Shift Length same day
 *
 * Using ±28 days as the universal window ensures every constraint has all
 * the data it needs while bounding the query to a predictable size.
 *
 * Expected rows loaded: typically < 50 (vs. potentially thousands without a window).
 */

import { format, addDays, subDays, parseISO } from 'date-fns';

// =============================================================================
// TYPES
// =============================================================================

export interface ScenarioWindow {
    /** Inclusive start date (YYYY-MM-DD). */
    start: string;
    /** Inclusive end date (YYYY-MM-DD). */
    end: string;
}

// The maximum look-behind / look-ahead required by any constraint.
export const SCENARIO_WINDOW_DAYS = 28 as const;

// =============================================================================
// UTILITY
// =============================================================================

/**
 * Calculate a ±28-day scenario window centered on the candidate shift date.
 *
 * @param shiftDate  YYYY-MM-DD string (the candidate or reference shift date).
 * @param days       Optional override for the window size in days (default 28).
 * @returns          ScenarioWindow with `start` and `end` as YYYY-MM-DD strings.
 *
 * @example
 * getScenarioWindow('2025-06-15')
 * // → { start: '2025-05-18', end: '2025-07-13' }
 */
export function getScenarioWindow(
    shiftDate: string,
    days: number = SCENARIO_WINDOW_DAYS,
): ScenarioWindow {
    const ref = parseISO(shiftDate);
    return {
        start: format(subDays(ref, days), 'yyyy-MM-dd'),
        end:   format(addDays(ref, days), 'yyyy-MM-dd'),
    };
}
