import { startOfDay, isBefore, isAfter, isSameDay, format as formatDateFns } from 'date-fns';
import { toZonedTime, format as formatZoned, toDate } from 'date-fns-tz';

// Default fallback timezone if none provided
export const SYDNEY_TZ = 'Australia/Sydney';

/**
 * Gets the current date in the specified timezone, with time set to 00:00:00
 * Use this to get "Today" in the target timezone.
 * @param timezone The IANA timezone identifier (default: Australia/Sydney)
 */
export const getTodayInTimezone = (timezone: string = SYDNEY_TZ): Date => {
    // Get current time in target timezone
    const nowInTz = toZonedTime(new Date(), timezone);
    // Return start of that day
    return startOfDay(nowInTz);
};

/**
 * Gets the current full Date object (timestamp) in the specified timezone
 * @param timezone The IANA timezone identifier (default: Australia/Sydney)
 */
export const getNowInTimezone = (timezone: string = SYDNEY_TZ): Date => {
    return toZonedTime(new Date(), timezone);
};

/**
 * Checks if a date is strictly in the past relative to "Today" in the specified timezone
 * @param date The date to check
 * @param timezone The IANA timezone identifier
 */
export const isPastInTimezone = (date: Date, timezone: string = SYDNEY_TZ): boolean => {
    const today = getTodayInTimezone(timezone);
    return isBefore(date, today);
};

/**
 * Checks if a date is strictly in the future relative to "Today" in the specified timezone
 * @param date The date to check
 * @param timezone The IANA timezone identifier
 */
export const isFutureInTimezone = (date: Date, timezone: string = SYDNEY_TZ): boolean => {
    const today = getTodayInTimezone(timezone);
    return isAfter(date, today);
};

/**
 * Checks if a date is "Today" in the specified timezone
 * @param date The date to check
 * @param timezone The IANA timezone identifier
 */
export const isTodayInTimezone = (date: Date, timezone: string = SYDNEY_TZ): boolean => {
    const today = getTodayInTimezone(timezone);
    return isSameDay(date, today);
};

/**
 * Combines a date string (YYYY-MM-DD) and a time string (HH:mm) into a Date object
 * that represents that specific wall-clock time in the target timezone.
 * 
 * Example: "2023-10-01", "10:00", "Australia/Sydney"
 * Result: The UTC timestamp corresponding to 10:00 AM Sydney time on that date.
 */
export const parseZonedDateTime = (dateStr: string, timeStr: string, timezone: string = SYDNEY_TZ): Date => {
    // timeStr might be "HH:mm" or "HH:mm:ss" from postgres. We only want HH:mm to append ":00" safely
    const cleanTimeStr = timeStr.slice(0, 5);
    const dateTimeStr = `${dateStr}T${cleanTimeStr}:00`;
    // toDate from date-fns-tz takes an ISO string (without offset) and interprets it as being in the target timezone
    return toDate(dateTimeStr, { timeZone: timezone });
};

/**
 * Formats a Date object into a string using the target timezone.
 * @param date The date to format
 * @param timezone The IANA timezone identifier (e.g. 'Australia/Sydney')
 * @param formatStr The format string (e.g. 'yyyy-MM-dd', 'HH:mm', 'EEE')
 */
export const formatInTimezone = (date: Date, timezone: string = SYDNEY_TZ, formatStr: string = 'yyyy-MM-dd'): string => {
    return formatZoned(date, formatStr, { timeZone: timezone });
};

// --- LEGACY COMPATIBILITY (Deprecate gradually) ---

/**
 * @deprecated Use getTodayInTimezone(timezone) instead
 */
export const getSydneyToday = (): Date => getTodayInTimezone(SYDNEY_TZ);

/**
 * @deprecated Use getNowInTimezone(timezone) instead
 */
export const getSydneyNow = (): Date => getNowInTimezone(SYDNEY_TZ);

/**
 * @deprecated Use isPastInTimezone(date, timezone) instead
 */
export const isSydneyPast = (date: Date): boolean => isPastInTimezone(date, SYDNEY_TZ);

/**
 * @deprecated Use isFutureInTimezone(date, timezone) instead
 */
export const isSydneyFuture = (date: Date): boolean => isFutureInTimezone(date, SYDNEY_TZ);

/**
 * @deprecated Use isTodayInTimezone(date, timezone) instead
 */
/**
 * @deprecated Use isTodayInTimezone(date, timezone) instead
 */
export const isSydneyToday = (date: Date): boolean => isTodayInTimezone(date, SYDNEY_TZ);

/**
 * Checks if a given date is an Australian Public Holiday (2026)
 * @param date The date to check
 */
export const isPublicHoliday = (date: Date): boolean => {
    const month = date.getMonth(); // 0-indexed
    const d = date.getDate();
    const year = date.getFullYear();

    if (year !== 2026) {
        // Basic fixed-date fallback for other years
        if (month === 0 && d === 1) return true;   // New Year
        if (month === 0 && d === 26) return true;  // Australia Day
        if (month === 11 && d === 25) return true; // Christmas
        if (month === 11 && d === 26) return true; // Boxing Day
        return false;
    }

    // 2026 Specifics (NSW context)
    const holidays = [
        { m: 0, d: 1 },   // New Year
        { m: 0, d: 26 },  // Australia Day
        { m: 3, d: 3 },   // Good Friday (Apr 3)
        { m: 3, d: 4 },   // Easter Saturday
        { m: 3, d: 5 },   // Easter Sunday
        { m: 3, d: 6 },   // Easter Monday
        { m: 3, d: 25 },  // Anzac Day (Apr 25)
        { m: 5, d: 8 },   // King's Birthday (Jun 8)
        { m: 9, d: 5 },   // Labour Day (Oct 5)
        { m: 11, d: 25 }, // Christmas
        { m: 11, d: 26 }, // Boxing Day
    ];

    return holidays.some(h => h.m === month && h.d === d);
};

/**
 * Checks if a specific wall-clock time on a specific date has already passed in Sydney.
 * Useful for locking "today's" shifts once they have started.
 * 
 * @param dateStr ISO date string (YYYY-MM-DD)
 * @param timeStr 24h time string (HH:mm)
 */
export const isSydneyStarted = (dateStr: string, timeStr: string): boolean => {
    if (!dateStr || !timeStr) return false;
    const shiftStart = parseZonedDateTime(dateStr, timeStr, SYDNEY_TZ);
    const now = getSydneyNow();
    return now >= shiftStart;
};
