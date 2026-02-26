/**
 * Duration utilities — pure arithmetic, no side effects.
 *
 * Used by every projector to produce netMinutes without inconsistency.
 */

import type { Shift } from '../../shift.entity';

/**
 * Parse "HH:MM" or "HH:MM:SS" → total minutes since midnight.
 * Returns 0 for malformed input (fail-safe, never throws).
 */
export function parseTimeToMinutes(time: string): number {
  if (!time) return 0;
  const parts = time.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

/**
 * Gross minutes between two "HH:MM" wall-clock times.
 * Handles overnight shifts (end < start) by adding 24 h.
 */
export function grossMinutes(startTime: string, endTime: string): number {
  const start = parseTimeToMinutes(startTime);
  let   end   = parseTimeToMinutes(endTime);
  if (end <= start) end += 24 * 60; // overnight crossing
  return end - start;
}

/**
 * Net minutes for a shift — preferred column first, fallback to gross − breaks.
 * Always returns a non-negative integer.
 */
export function netMinutesFromShift(shift: Pick<
  Shift,
  'net_length_minutes' | 'start_time' | 'end_time' | 'unpaid_break_minutes'
>): number {
  if (shift.net_length_minutes != null && shift.net_length_minutes > 0) {
    return shift.net_length_minutes;
  }
  const gross  = grossMinutes(shift.start_time, shift.end_time);
  const breaks = shift.unpaid_break_minutes ?? 0;
  return Math.max(0, gross - breaks);
}

/**
 * Format a minute count as a compact human string.
 * e.g. 480 → "8h", 510 → "8h 30m", 45 → "45m"
 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Convert minutes to fractional hours, rounded to 2 dp.
 */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
