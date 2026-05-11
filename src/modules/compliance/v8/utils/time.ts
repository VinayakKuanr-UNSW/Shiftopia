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
 * Compare two date strings (YYYY-MM-DD).
 */
export function compareDates(a: string, b: string): number {
    return a.localeCompare(b);
}
