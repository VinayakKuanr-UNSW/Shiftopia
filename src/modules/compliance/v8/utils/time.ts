/**
 * V8 Compliance Engine — Time Utilities
 * 
 * High-performance integer arithmetic for time calculations.
 * Worker-safe and zero-allocation.
 */

/**
 * Parse a time string "HH:MM" or "HH:MM:SS" into minutes since midnight.
 * Returns 0 for malformed or empty strings to prevent RangeErrors.
 */
export function parseTimeToMinutes(time?: string | null): number {
    if (!time) return 0;
    const parts = time.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (isNaN(h) || isNaN(m)) return 0;
    return (h * 60) + m;
}

/**
 * Duration of a shift in minutes — the single source of truth for cross-midnight
 * duration across every V8 rule (previously each rule inlined its own `+1440`
 * variant, and they disagreed on the `end == start` edge — audit M1).
 *
 * A shift crosses midnight when its end time is strictly earlier than its start
 * (`end < start → +24h`). `end == start` is treated as ZERO length (a degenerate
 * / placeholder shift), NOT 24h, so malformed data cannot spuriously trip the
 * daily-hours, spread or meal-break caps.
 */
export function shiftDurationMinutes(start?: string | null, end?: string | null): number {
    const s = parseTimeToMinutes(start);
    let e = parseTimeToMinutes(end);
    if (e < s) e += 1440;
    return e - s;
}

/**
 * The shift's end time in minutes-from-start-day-midnight, normalized for cross-
 * midnight (`end < start → +1440`). Use when start and end are needed separately
 * (e.g. spread-of-hours' earliest-start / latest-end). Same convention as
 * {@link shiftDurationMinutes}.
 */
export function normalizedEndMinutes(start?: string | null, end?: string | null): number {
    const s = parseTimeToMinutes(start);
    let e = parseTimeToMinutes(end);
    if (e < s) e += 1440;
    return e;
}

/**
 * Compare two date strings (YYYY-MM-DD).
 */
export function compareDates(a: string, b: string): number {
    return a.localeCompare(b);
}
