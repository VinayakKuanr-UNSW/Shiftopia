import Holidays from 'date-holidays';

/**
 * Single source of truth for Australian public holidays across the whole app.
 *
 * The organisation operates out of ICC Sydney, so NSW state holidays apply on
 * top of the national ones. This same instance backs both the payroll/award
 * cost engine and every calendar surface — public holidays are marked in
 * yellow on the shared `Calendar` primitive and the roster/availability grids.
 */
export const ausHolidays = new Holidays('AU', 'NSW');

/** Returns the matching *public* holiday entry for a date, or null. */
function getPublicHolidayEntry(date: Date) {
  const matches = ausHolidays.isHoliday(date);
  if (!matches) return null;
  const list = Array.isArray(matches) ? matches : [matches];
  // Only genuine public holidays — ignore bank/observance/optional/school days.
  return list.find((h) => h.type === 'public') ?? null;
}

/** True when the given date is an Australian (NSW) public holiday. */
export function isPublicHoliday(date: Date): boolean {
  return getPublicHolidayEntry(date) !== null;
}

/** Human-readable name of the public holiday on a date, or null if none. */
export function getPublicHolidayName(date: Date): string | null {
  return getPublicHolidayEntry(date)?.name ?? null;
}

/**
 * Sunday / public-holiday day-typing for a `YYYY-MM-DD` shift date, parsed on
 * LOCAL date parts (never through a UTC `Date` constructor, which can roll the
 * day depending on the browser/server timezone). Single source of truth for
 * the day-type flags EBA rules key off (minimum engagement, penalty loadings)
 * — callers should use this instead of re-deriving `getDay() === 0` /
 * `isHoliday()` themselves.
 */
export function getShiftDayType(dateStr: string | null | undefined): { isSunday: boolean; isPublicHoliday: boolean } {
  if (!dateStr) return { isSunday: false, isPublicHoliday: false };
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return { isSunday: false, isPublicHoliday: false };
  const localDate = new Date(year, month - 1, day);
  return {
    isSunday: localDate.getDay() === 0,
    isPublicHoliday: isPublicHoliday(localDate),
  };
}
