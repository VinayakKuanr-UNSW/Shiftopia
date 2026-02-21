import { format, parseISO, startOfDay, endOfDay, addDays, subDays, isBefore, isAfter, isEqual } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Core utility for timezone-aware date handling.
 * This should be used instead of local `new Date()` wherever absolute time matters (like shift start/end).
 */

// Default timezone fallback if not provided by context
export const DEFAULT_TIMEZONE = 'Australia/Sydney';

/**
 * Gets the current Date object representing the time in the given timezone.
 */
export const getZonedNow = (timeZone: string = DEFAULT_TIMEZONE): Date => {
    return toZonedTime(new Date(), timeZone);
};

/**
 * Parses an ISO UTC string into a timezone-aware Date object.
 */
export const parseZonedTime = (isoString: string, timeZone: string = DEFAULT_TIMEZONE): Date => {
    return toZonedTime(parseISO(isoString), timeZone);
};

/**
 * Converts a local date/time (e.g. from a date picker) into a UTC absolute timestamp string,
 * treating the input as if it occurred in the specified timezone.
 * 
 * E.g. "2026-02-20T09:00:00" picked by user for Sydney -> Converts to UTC "2026-02-19T22:00:00.000Z"
 */
export const getUtcStringFromZoned = (localDate: Date, timeZone: string = DEFAULT_TIMEZONE): string => {
    const utcDate = fromZonedTime(localDate, timeZone);
    return utcDate.toISOString();
};

/**
 * Formats an absolute UTC date string for display in a specific timezone safely.
 * E.g. "2026-02-19T22:00:00.000Z" -> "09:00" in Sydney
 */
export const formatZonedTime = (isoString: string, dateFormat: string, timeZone: string = DEFAULT_TIMEZONE): string => {
    if (!isoString) return '';
    try {
        return formatInTimeZone(isoString, timeZone, dateFormat);
    } catch (error) {
        console.error('Error formatting zoned time:', error);
        return '';
    }
};

/**
 * Safely compare two absolute UTC strings
 */
export const isBeforeZoned = (dateStr1: string, dateStr2: string): boolean => {
    return isBefore(parseISO(dateStr1), parseISO(dateStr2));
};

export const isAfterZoned = (dateStr1: string, dateStr2: string): boolean => {
    return isAfter(parseISO(dateStr1), parseISO(dateStr2));
};

/**
 * Gets start and endOfDay in UTC for a given local date string (e.g., '2026-02-20') in a specific timezone.
 */
export const getDayBoundsInUTC = (localDateString: string, timeZone: string = DEFAULT_TIMEZONE) => {
    // Parse 'YYYY-MM-DD' as local to the timezone
    const dateObj = new Date(localDateString + 'T00:00:00');
    const start = fromZonedTime(dateObj, timeZone);
    const end = fromZonedTime(new Date(localDateString + 'T23:59:59.999'), timeZone);

    return {
        startUtc: start.toISOString(),
        endUtc: end.toISOString()
    };
};
