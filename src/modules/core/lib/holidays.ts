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
