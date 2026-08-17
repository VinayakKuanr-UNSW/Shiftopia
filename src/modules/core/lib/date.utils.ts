import { startOfDay, isBefore, isAfter, isSameDay, format as formatDateFns, parseISO } from 'date-fns';
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
    // date-fns-tz `format` only uses `timeZone` for zone-NAME tokens (z/zzz/xxx) —
    // it does NOT convert the numeric H/m/d fields. Passing a raw UTC instant would
    // therefore render in the runtime's LOCAL zone. `toZonedTime` shifts the instant
    // so its wall-clock fields represent the target zone; then formatting is correct
    // (AEST/AEDT) regardless of the viewer's browser timezone.
    return formatZoned(toZonedTime(date, timezone), formatStr, { timeZone: timezone });
};

// --- CANONICAL SHIFT WALL-CLOCK (always AEST/AEDT) ---------------------------
//
// This is an Australian app: shift times must ALWAYS display in Australia/Sydney
// (AEST in winter / AEDT in summer — the IANA zone handles DST automatically),
// regardless of the viewer's browser timezone.
//
// Source of truth = the authored naive fields (shift_date + start_time/end_time),
// which are the Sydney wall-clock the roster was built in. The `start_at`/`end_at`
// timestamptz columns are DERIVED (a DB trigger recomputes them from the naive
// fields) and can drift/go stale, so they are only a fallback. Never format shift
// times through the browser's local zone, and never trust a per-row tz column for
// DISPLAY — pin to SYDNEY_TZ.

export interface ShiftTimeFields {
    shift_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    start_at?: string | null;
    end_at?: string | null;
}

/**
 * Resolve a shift's start/end as an absolute instant whose Sydney wall-clock is
 * the authored time. Prefers naive shift_date + start_time/end_time; falls back
 * to start_at/end_at. Returns null when nothing usable is present.
 */
export const getShiftInstant = (
    shift: ShiftTimeFields | null | undefined,
    part: 'start' | 'end' = 'start',
): Date | null => {
    if (!shift) return null;
    const time = part === 'start' ? shift.start_time : shift.end_time;
    if (shift.shift_date && time) {
        const d = parseZonedDateTime(shift.shift_date, time, SYDNEY_TZ);
        if (!isNaN(d.getTime())) return d;
    }
    const at = part === 'start' ? shift.start_at : shift.end_at;
    if (at) {
        const d = new Date(at);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
};

/**
 * Format a shift's start/end time in Australia/Sydney (AEST/AEDT),
 * browser-timezone-independent.
 * @param fmt date-fns format string (e.g. 'HH:mm', 'h:mm a')
 */
export const formatShiftTime = (
    shift: ShiftTimeFields | null | undefined,
    part: 'start' | 'end' = 'start',
    fmt: string = 'HH:mm',
    fallback: string = '',
): string => {
    const d = getShiftInstant(shift, part);
    return d ? formatInTimezone(d, SYDNEY_TZ, fmt) : fallback;
};

/**
 * Format a shift's calendar date in Australia/Sydney (AEST/AEDT).
 * Prefers the authored shift_date; falls back to start_at.
 * @param fmt date-fns format string (e.g. 'EEE, MMM d', 'yyyy-MM-dd')
 */
export const formatShiftDate = (
    shift: ShiftTimeFields | null | undefined,
    fmt: string = 'EEE, MMM d',
    fallback: string = '',
): string => {
    if (shift?.shift_date) {
        const d = parseZonedDateTime(shift.shift_date, shift.start_time || '00:00', SYDNEY_TZ);
        if (!isNaN(d.getTime())) return formatInTimezone(d, SYDNEY_TZ, fmt);
    }
    const d = getShiftInstant(shift, 'start');
    return d ? formatInTimezone(d, SYDNEY_TZ, fmt) : fallback;
};

/**
 * Format a plain calendar-date string (e.g. 'yyyy-MM-dd') for display WITHOUT any
 * timezone shift. `new Date('2026-07-13')` parses as UTC midnight and, formatted
 * with date-fns (local fields), renders the PREVIOUS day west of Greenwich. A
 * calendar date has no timezone, so parse it as a local wall-clock date — the
 * output is then the literal date in every browser tz. Full ISO instants
 * (length > 10) are rendered in Sydney instead.
 * @param fmt date-fns format (e.g. 'EEE, MMM d', 'MMM d, yyyy')
 */
export const formatCalendarDate = (
    dateStr: string | null | undefined,
    fmt: string = 'EEE, MMM d',
    fallback: string = '',
): string => {
    if (!dateStr) return fallback;
    if (dateStr.length <= 10) {
        const d = parseISO(dateStr); // local midnight — no tz drift for date-only
        return isNaN(d.getTime()) ? fallback : formatDateFns(d, fmt);
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? fallback : formatInTimezone(d, SYDNEY_TZ, fmt);
};

/**
 * Today's calendar date as 'yyyy-MM-dd' in the given timezone (default Sydney).
 * Use instead of `format(new Date(), 'yyyy-MM-dd')`, which yields the browser's
 * local calendar day and can be off by one near midnight for non-Sydney viewers.
 */
export const todayISO = (timezone: string = SYDNEY_TZ): string =>
    formatInTimezone(new Date(), timezone, 'yyyy-MM-dd');

/** Sydney calendar date (yyyy-MM-dd) for range/bucket filtering. */
export const getShiftDateKey = (shift: ShiftTimeFields | null | undefined): string | undefined => {
    if (shift?.shift_date) return shift.shift_date;
    const d = getShiftInstant(shift, 'start');
    return d ? formatInTimezone(d, SYDNEY_TZ, 'yyyy-MM-dd') : undefined;
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
 * Checks if a given date is an Australian (NSW) public holiday.
 *
 * @deprecated Import from `@/modules/core/lib/holidays` instead. Re-exported
 * here only so existing call sites keep working; new code should not add to
 * them. This used to be a hard-coded 2026 list that returned `false` for
 * Easter, Anzac Day, King's Birthday and Labour Day in every other year — and
 * it fed `is_public_holiday` into the V8 compliance engine and the shift form's
 * minimum-engagement floor. It also omitted the NSW substitute days (Mon 27 Apr
 * 2026 for Anzac Day, Mon 28 Dec 2026 for Boxing Day), which do attract
 * public-holiday penalty rates.
 */
export { isPublicHoliday } from '@/modules/core/lib/holidays';

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
    const now = new Date(); // Absolute UTC comparison
    return now >= shiftStart;
};
