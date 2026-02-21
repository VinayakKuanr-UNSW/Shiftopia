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
    const dateTimeStr = `${dateStr}T${timeStr}:00`;
    // toDate from date-fns-tz takes an ISO string (without offset) and interprets it as being in the target timezone
    return toDate(dateTimeStr, { timeZone: timezone });
};

/**
 * Formats a Date object into a string using the target timezone.
 * @param date The date to format
 * @param formatStr The format string (e.g. 'yyyy-MM-dd')
 * @param timezone The IANA timezone identifier
 */
export const formatInTimezone = (date: Date, formatStr: string, timezone: string = SYDNEY_TZ): string => {
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
export const isSydneyToday = (date: Date): boolean => isTodayInTimezone(date, SYDNEY_TZ);
