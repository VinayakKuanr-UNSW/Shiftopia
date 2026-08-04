// src/modules/core/lib/anz-holidays.ts

import { format, parseISO } from 'date-fns';

/**
 * ANZ (Australia & New Zealand) Public Holidays dictionary.
 * Primary focus on AU (NSW / Federal - ICC Sydney context) + NZ National Holidays.
 */
export const ANZ_PUBLIC_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-02': "Day after New Year's Day",
  '2025-01-27': 'Australia Day',
  '2025-02-06': 'Waitangi Day',
  '2025-04-18': 'Good Friday',
  '2025-04-19': 'Easter Saturday',
  '2025-04-20': 'Easter Sunday',
  '2025-04-21': 'Easter Monday',
  '2025-04-25': 'ANZAC Day',
  '2025-06-09': "King's Birthday",
  '2025-06-20': 'Matariki',
  '2025-08-04': 'Bank Holiday',
  '2025-10-06': 'Labour Day',
  '2025-10-27': 'NZ Labour Day',
  '2025-12-25': 'Christmas Day',
  '2025-12-26': 'Boxing Day',

  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-02': "Day after New Year's Day",
  '2026-01-26': 'Australia Day',
  '2026-02-06': 'Waitangi Day',
  '2026-04-03': 'Good Friday',
  '2026-04-04': 'Easter Saturday',
  '2026-04-05': 'Easter Sunday',
  '2026-04-06': 'Easter Monday',
  '2026-04-25': 'ANZAC Day',
  '2026-06-08': "King's Birthday",
  '2026-07-10': 'Matariki',
  '2026-08-03': 'Bank Holiday',
  '2026-10-05': 'Labour Day',
  '2026-10-26': 'NZ Labour Day',
  '2026-12-25': 'Christmas Day',
  '2026-12-26': 'Boxing Day',
  '2026-12-28': 'Boxing Day (Observed)',

  // 2027
  '2027-01-01': "New Year's Day",
  '2027-01-02': "Day after New Year's Day",
  '2027-01-26': 'Australia Day',
  '2027-02-06': 'Waitangi Day',
  '2027-03-26': 'Good Friday',
  '2027-03-27': 'Easter Saturday',
  '2027-03-28': 'Easter Sunday',
  '2027-03-29': 'Easter Monday',
  '2027-04-25': 'ANZAC Day',
  '2027-06-14': "King's Birthday",
  '2027-06-25': 'Matariki',
  '2027-08-02': 'Bank Holiday',
  '2027-10-04': 'Labour Day',
  '2027-10-25': 'NZ Labour Day',
  '2027-12-25': 'Christmas Day',
  '2027-12-27': 'Christmas Day (Observed)',
  '2027-12-28': 'Boxing Day (Observed)',
};

/**
 * Returns the ANZ Public Holiday name if the date falls on a public holiday, or null.
 */
export function getAnzHolidayName(dateInput: Date | string): string | null {
  let dateStr: string;
  if (typeof dateInput === 'string') {
    dateStr = dateInput.substring(0, 10);
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    dateStr = format(dateInput, 'yyyy-MM-dd');
  } else {
    return null;
  }

  // Exact lookup
  if (ANZ_PUBLIC_HOLIDAYS[dateStr]) {
    return ANZ_PUBLIC_HOLIDAYS[dateStr];
  }

  // Annual fixed date fallback for any unlisted year
  const mmdd = dateStr.substring(5);
  switch (mmdd) {
    case '01-01': return "New Year's Day";
    case '01-02': return "Day after New Year's Day";
    case '01-26': return 'Australia Day';
    case '02-06': return 'Waitangi Day';
    case '04-25': return 'ANZAC Day';
    case '12-25': return 'Christmas Day';
    case '12-26': return 'Boxing Day';
    default: return null;
  }
}

/**
 * Returns true if the given date is an ANZ Public Holiday.
 */
export function isAnzHoliday(dateInput: Date | string): boolean {
  return getAnzHolidayName(dateInput) !== null;
}
