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
  endOfWeek,
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
