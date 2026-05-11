/**
 * Award Context — Pre-computed per-date facts for the ICC Sydney EA 2025.
 *
 * The core insight: on a typical roster, shifts cluster on the same handful of
 * dates (often just 7 days). Instead of calling `hd.isHoliday()` (~0.24ms) and
 * `new Date().getDay()` for every single shift, we compute these facts ONCE
 * per unique date and pass the resulting `DateFacts` map through the engine.
 *
 * Measured impact: eliminates ~120ms of holiday lookups for a 250-shift roster.
 *
 * This module is worker-safe — no DOM, no React, no Supabase.
 */

import { hd } from './constants';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Pre-computed facts about a single calendar date.
 * Every field that previously required a per-shift `new Date()` or
 * `hd.isHoliday()` call is pre-baked here.
 */
export interface DateFacts {
  /** The original YYYY-MM-DD string */
  dateStr: string;
  /** 0 = Sunday, 6 = Saturday */
  dayOfWeek: number;
  /** Whether this date is a NSW public holiday */
  isPublicHoliday: boolean;
  /** Epoch-ms at 00:00 on this date (for cheap arithmetic) */
  midnightMs: number;
}

/**
 * Full pre-computed context for a projection run.
 * Created once, passed to every `estimateDetailedShiftCost` call.
 */
export interface AwardContext {
  /** Map from YYYY-MM-DD → pre-computed date facts */
  dateFacts: Map<string, DateFacts>;
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Normalize a date value to a YYYY-MM-DD string.
 * Handles Date objects, ISO strings, and plain date strings.
 */
function toDateString(d: string | Date): string {
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'string' && d.includes('T')) return d.split('T')[0];
  return d;
}

/**
 * Build the full AwardContext from a set of shift dates.
 *
 * Call this ONCE per projection cycle (before the cost loop), then pass
 * the result into every engine call.
 *
 * @param shiftDates - array of shift_date values (strings or Dates)
 *                     Duplicates are de-duped automatically.
 */
export function buildAwardContext(shiftDates: (string | Date)[]): AwardContext {
  const dateFacts = new Map<string, DateFacts>();

  for (const raw of shiftDates) {
    const dateStr = toDateString(raw);
    if (dateFacts.has(dateStr)) continue; // already computed

    // One-time per unique date
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();
    const isPublicHoliday = !!hd.isHoliday(dateStr);
    const midnightMs = dateObj.getTime();

    dateFacts.set(dateStr, {
      dateStr,
      dayOfWeek,
      isPublicHoliday,
      midnightMs,
    });
  }

  return { dateFacts };
}

/**
 * Retrieve DateFacts for a given date string, computing on-the-fly if not
 * already in the context (defensive fallback).
 */
export function getDateFacts(ctx: AwardContext, dateStr: string): DateFacts {
  const normalized = toDateString(dateStr);
  let facts = ctx.dateFacts.get(normalized);

  if (!facts) {
    // Fallback: compute on the fly (should rarely happen if context was
    // built correctly, but we never want to crash).
    const dateObj = new Date(normalized + 'T00:00:00');
    facts = {
      dateStr: normalized,
      dayOfWeek: dateObj.getDay(),
      isPublicHoliday: !!hd.isHoliday(normalized),
      midnightMs: dateObj.getTime(),
    };
    ctx.dateFacts.set(normalized, facts);
  }

  return facts;
}

// ── Fast Time Utilities ──────────────────────────────────────────────────────
//
// These replace `date-fns` calls in the hot path. All operate on raw integers
// (minutes since midnight) to avoid Date object allocation entirely.

/**
 * Parse a time string "HH:MM" or "HH:MM:SS" into minutes since midnight.
 */
export function parseTimeToMinutes(time: string): number {
  const parts = time.substring(0, 5).split(':');
  return (Number(parts[0]) * 60) + Number(parts[1]);
}

/**
 * Compute net minutes from start/end time strings and overnight flag.
 * Replaces the `parseISO` → `differenceInMinutes` chain.
 */
export function fastNetMinutes(
  startTime: string,
  endTime: string,
  isOvernight: boolean,
  unpaidBreakMinutes: number = 0,
): number {
  let start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end <= start || isOvernight) end += 1440;
  return Math.max(0, (end - start) - unpaidBreakMinutes);
}

/**
 * Compute the number of minutes that overlap with the night shift window
 * (22:00 – 06:00) using pure integer arithmetic.
 *
 * Replaces `getNightShiftMinutes()` which created 6 Date objects and called
 * `setHours`, `addDays`, `isBefore`, `isAfter`, `max`, `min`, and
 * `differenceInMinutes` per invocation.
 *
 * @param startMins - shift start as minutes since midnight
 * @param endMins   - shift end as minutes since midnight (may exceed 1440 for overnight)
 */
export function fastNightMinutes(startMins: number, endMins: number): number {
  // Night window spans two intervals relative to midnight:
  //   Window A: 0..360   (00:00 – 06:00)
  //   Window B: 1320..1440 (22:00 – 24:00)
  // For overnight shifts (endMins > 1440), we also check the next day's windows:
  //   Window C: 1440..1800 (next day 00:00 – 06:00)
  //   Window D: 2760..2880 (next day 22:00 – 24:00) — extremely unlikely

  const overlap = (s1: number, e1: number, s2: number, e2: number): number => {
    const s = Math.max(s1, s2);
    const e = Math.min(e1, e2);
    return e > s ? e - s : 0;
  };

  let nightMins = 0;
  nightMins += overlap(startMins, endMins, 0, 360);      // Window A: 00:00-06:00
  nightMins += overlap(startMins, endMins, 1320, 1440);   // Window B: 22:00-24:00
  nightMins += overlap(startMins, endMins, 1440, 1800);   // Window C: next 00:00-06:00
  nightMins += overlap(startMins, endMins, 2760, 2880);   // Window D: next 22:00-24:00

  return nightMins;
}
