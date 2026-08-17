/**
 * Australian week & month-grid date math — the single source of truth.
 *
 * WHY THIS EXISTS
 * ---------------
 * `date-fns` defaults `weekStartsOn` to 0 (Sunday). Every call site that forgot
 * the option silently produced a Sunday-start week, which is wrong for an
 * Australian roster: the EBA week, the payroll period and the roster grid all
 * run Monday–Sunday. Before this module the app had a mix of
 * `startOfWeek(d)` (Sunday), `startOfWeek(d, { weekStartsOn: 0 })` (explicitly
 * Sunday) and `startOfWeek(d, { weekStartsOn: 1 })` (correct) — three answers to
 * the same question.
 *
 * RULE: application code must not import `startOfWeek` / `endOfWeek` from
 * `date-fns` directly. Import the `*AU` helpers here instead. They take no
 * options, so there is nothing to forget.
 *
 * Everything here is pure and timezone-naive: it operates on local-field `Date`
 * objects the way the roster grid does. For instant-based work (comparing to a
 * real point in time) use `core/lib/date.utils.ts`.
 */

import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  type Day,
} from 'date-fns';

/**
 * Monday. The only week start this application recognises.
 *
 * Exported for the rare case where a `date-fns` function not wrapped below
 * needs the option (e.g. `getWeekOfMonth`). Prefer the helpers.
 */
export const WEEK_STARTS_ON = 1 satisfies Day;

/** Pre-built options object for `date-fns` calls that take `{ weekStartsOn }`. */
export const AU_WEEK_OPTIONS = { weekStartsOn: WEEK_STARTS_ON } as const;

/** Monday of the week containing `date`. */
export const startOfWeekAU = (date: Date): Date => startOfWeek(date, AU_WEEK_OPTIONS);

/** Sunday of the week containing `date`. */
export const endOfWeekAU = (date: Date): Date => endOfWeek(date, AU_WEEK_OPTIONS);

/** The seven days Mon→Sun of the week containing `date`. */
export function getWeekDays(date: Date): Date[] {
  const start = startOfWeekAU(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The days of the month containing `date`, padded out to whole Mon–Sun weeks —
 * i.e. exactly what a month calendar renders, leading/trailing "outside" days
 * included.
 *
 * Length is 28, 35 or 42 depending on the month; it is NOT hard-coded to 42.
 * Several of the hand-rolled grids this replaces padded unconditionally to 42
 * and so rendered a phantom seventh week.
 */
export function getMonthGridDays(date: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeekAU(startOfMonth(date)),
    end: endOfWeekAU(endOfMonth(date)),
  });
}

/** `getMonthGridDays` chunked into weeks — one inner array per rendered row. */
export function getMonthGridWeeks(date: Date): Date[][] {
  const days = getMonthGridDays(date);
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/**
 * Weekday column labels, Mon→Sun, in the three lengths the UI uses.
 *
 * `narrow` collides (T/T, S/S) and is decorative only: render it with
 * `aria-hidden` alongside an `sr-only` `long` label, never on its own.
 */
export const WEEKDAY_LABELS = {
  narrow: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  short: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  long: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
} as const;

export type WeekdayLabelWidth = keyof typeof WEEKDAY_LABELS;

/**
 * Column index (0 = Monday … 6 = Sunday) for a date.
 *
 * Replaces the `(getDay(d) + 6) % 7` incantation that was copy-pasted across
 * the hand-rolled grids to convert JS's Sunday-first `getDay()`.
 */
export const getWeekdayIndexAU = (date: Date): number => (date.getDay() + 6) % 7;

/** True for Saturday or Sunday. */
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};
