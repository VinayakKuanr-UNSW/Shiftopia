/**
 * The period a roster view stands for — pure, no React.
 *
 * One definition shared by the navigator's label, the Publish dialog's label and
 * the range Publish acts on, so the three cannot disagree. (They did: Month-view
 * Publish read the grid's ±3-day viewing buffer and published outside the month
 * the dialog named.) The grid may SHOW more than this — the month buffer is for
 * viewing only — but nothing writes outside it.
 *
 * Moved from UnifiedRosterNavigator, which re-exports these unchanged.
 *
 * Navigation rules:
 *   Day   → ± 1 day
 *   3-Day → ± 3 days
 *   Week  → ± 7 days  (week start = Monday)
 *   Month → ± 1 month (anchor date preserved; range snaps to full month)
 */
import {
  format,
  addDays, subDays,
  addMonths, subMonths,
  startOfMonth, endOfMonth,
} from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';

export type ViewType = 'day' | '3day' | 'week' | 'month';

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Compute the inclusive date range for an anchor date + view type.
 * Week starts on Monday. Month range = full calendar month.
 */
export function computeRange(date: Date, viewType: ViewType): DateRange {
  switch (viewType) {
    case 'day':
      return { start: date, end: date };
    case '3day':
      return { start: date, end: addDays(date, 2) };
    case 'week':
      return { start: startOfWeekAU(date), end: endOfWeekAU(date) };
    case 'month':
      return { start: startOfMonth(date), end: endOfMonth(date) };
  }
}

/** The same range as `yyyy-MM-dd` keys, for queries. */
export function computeRangeKeys(date: Date, viewType: ViewType): { startDate: string; endDate: string } {
  const { start, end } = computeRange(date, viewType);
  return { startDate: format(start, 'yyyy-MM-dd'), endDate: format(end, 'yyyy-MM-dd') };
}

/**
 * Move an anchor date by one period in the given direction.
 * dir = 1 → forward, dir = -1 → backward.
 */
export function navigateDate(date: Date, viewType: ViewType, dir: -1 | 1): Date {
  switch (viewType) {
    case 'day':   return dir === 1 ? addDays(date, 1)    : subDays(date, 1);
    case '3day':  return dir === 1 ? addDays(date, 3)    : subDays(date, 3);
    case 'week':  return dir === 1 ? addDays(date, 7)    : subDays(date, 7);
    case 'month': return dir === 1 ? addMonths(date, 1)  : subMonths(date, 1);
  }
}

/**
 * Human-readable range label.
 *
 *   day   → Mon, 21 Apr
 *   3day  → 21 Apr – 23 Apr
 *   week  → 21 – 27 Apr  (or  28 Apr – 4 May  across month boundary)
 *   month → April 2026
 */
export function formatRangeLabel(range: DateRange, viewType: ViewType): string {
  const { start, end } = range;
  switch (viewType) {
    case 'day':
      return format(start, 'EEE, d MMM');
    case '3day':
      return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
    case 'week':
      return start.getMonth() === end.getMonth()
        ? `${format(start, 'd')} – ${format(end, 'd MMM')}`
        : `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
    case 'month':
      return format(start, 'MMMM yyyy');
  }
}
