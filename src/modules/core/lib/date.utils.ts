import { startOfDay, isBefore, isSameDay, format as formatDateFns, parseISO } from 'date-fns';
import { toZonedTime, format as formatZoned, toDate } from 'date-fns-tz';
import { venueZone, shiftZone, DEFAULT_VENUE_ZONE, type VenueRef } from './venue';

/**
 * ICC Sydney's zone. Only for code that is still Sydney-pinned (the
 * AutoScheduler); everything else asks the venue (`./venue`): a shift's own
 * zone, or `venueZone()` for the active venue, which every default below uses.
 */
export const SYDNEY_TZ = DEFAULT_VENUE_ZONE;

/**
 * Gets the current date in the specified timezone, with time set to 00:00:00
 * Use this to get "Today" in the target timezone.
 * @param timezone The IANA timezone identifier (default: the active venue's)
 */
export const getTodayInTimezone = (timezone: string = venueZone()): Date => {
    // Get current time in target timezone
    const nowInTz = toZonedTime(new Date(), timezone);
    // Return start of that day
    return startOfDay(nowInTz);
};

/**
 * Gets the current full Date object (timestamp) in the specified timezone
 * @param timezone The IANA timezone identifier (default: the active venue's)
 */
export const getNowInTimezone = (timezone: string = venueZone()): Date => {
    return toZonedTime(new Date(), timezone);
};

/**
 * Checks if a date is strictly in the past relative to "Today" in the specified timezone
 * @param date The date to check
 * @param timezone The IANA timezone identifier
 */
export const isPastInTimezone = (date: Date, timezone: string = venueZone()): boolean => {
    const today = getTodayInTimezone(timezone);
    return isBefore(date, today);
};


/**
 * Checks if a date is "Today" in the specified timezone
 * @param date The date to check
 * @param timezone The IANA timezone identifier
 */
export const isTodayInTimezone = (date: Date, timezone: string = venueZone()): boolean => {
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
export const parseZonedDateTime = (dateStr: string, timeStr: string, timezone: string = venueZone()): Date => {
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
export const formatInTimezone = (date: Date, timezone: string = venueZone(), formatStr: string = 'yyyy-MM-dd'): string => {
    // date-fns-tz `format` only uses `timeZone` for zone-NAME tokens (z/zzz/xxx) —
    // it does NOT convert the numeric H/m/d fields. Passing a raw UTC instant would
    // therefore render in the runtime's LOCAL zone. `toZonedTime` shifts the instant
    // so its wall-clock fields represent the target zone; then formatting is correct
    // (AEST/AEDT) regardless of the viewer's browser timezone.
    return formatZoned(toZonedTime(date, timezone), formatStr, { timeZone: timezone });
};

// --- CANONICAL SHIFT WALL-CLOCK (the venue's) --------------------------------
//
// Shift times ALWAYS display as the VENUE's wall clock (Australia/Sydney for ICC
// Sydney, Australia/Brisbane for BCEC — the IANA zone handles DST), regardless
// of the viewer's browser timezone.
//
// Source of truth = the authored naive fields (shift_date + start_time/end_time),
// which are the wall clock of the venue the roster was built in. The
// `start_at`/`end_at` timestamptz columns are DERIVED (a DB trigger recomputes
// them from the naive fields and the shift's zone) and are only a fallback.
// The zone is the shift's own `timezone` (stamped by the database from its
// organization), else its organization's, else the active venue's (`shiftZone`).
// Never format shift times through the browser's local zone.

export interface ShiftTimeFields extends VenueRef {
    shift_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    start_at?: string | null;
    end_at?: string | null;
}

/**
 * Resolve a shift's start/end as an absolute instant whose venue wall-clock is
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
        const d = parseZonedDateTime(shift.shift_date, time, shiftZone(shift));
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
 * Format a shift's start/end time as the venue's wall clock,
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
    return d ? formatInTimezone(d, shiftZone(shift), fmt) : fallback;
};

/**
 * Format any clock value a shift card shows — scheduled, clocked or adjusted —
 * as the venue's wall clock (`timezone`, default the active venue's), whatever
 * the viewer's timezone.
 *
 * The one formatter for the one job. There were three, and they disagreed:
 *
 *  - `ShiftDetailsDialog.formatWallClock` converted correctly.
 *  - `SmartShiftCard.formatTime` sliced the time out of the ISO string
 *    (`value.split('T')[1]`) and never converted, so a clock-in stored as
 *    `2026-08-20T00:25:05+00` rendered as "00:25" on the Rosters drill-down
 *    while My Attendance showed the same punch as 10:25 AM — the AEST offset,
 *    shown to a manager as the time someone started work.
 *  - `TimesheetMobileCard.formatTime` used `new Date(t).getHours()`, i.e. the
 *    BROWSER's zone. Right in Sydney by luck, wrong everywhere else — the same
 *    trap as reading a naive string as UTC.
 *
 * Handles both shapes a card is handed: a full timestamp (`actual_start`, a
 * timestamptz) and a naive wall-clock string (`start_time`, "HH:mm[:ss]",
 * already the venue's wall clock by definition and so never converted).
 */
export const formatClockTime = (
    value: string | null | undefined,
    fmt: string = 'h:mm a',
    fallback: string | null = null,
    timezone: string = venueZone(),
): string | null => {
    if (!value) return fallback;
    const raw = value.trim();
    if (!raw || raw === '-') return fallback;
    // Already formatted upstream — pass it through rather than re-parsing.
    if (/[AP]M$/i.test(raw)) return raw;

    // A full timestamp: an absolute instant, so convert it into the venue's zone.
    if (raw.includes('T') || (raw.length > 8 && raw.includes('-'))) {
        // Postgres renders a timestamptz as "2026-08-20 00:25:05+00" — a space
        // instead of T, and an hours-only offset that `new Date` rejects in
        // several engines. Normalise both before parsing.
        const iso = raw
            .replace(' ', 'T')
            .replace(/([+-]\d{2})$/, '$1:00');
        const d = new Date(iso);
        if (isNaN(d.getTime())) return fallback;
        return formatInTimezone(d, timezone, fmt);
    }

    // A naive wall-clock string is ALREADY the venue's; converting it would move it.
    const [h, m] = raw.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return fallback;
    return formatZoned(new Date(2000, 0, 1, h, m), fmt);
};

/**
 * Format a shift's calendar date in the venue's zone.
 * Prefers the authored shift_date; falls back to start_at.
 * @param fmt date-fns format string (e.g. 'EEE, MMM d', 'yyyy-MM-dd')
 */
export const formatShiftDate = (
    shift: ShiftTimeFields | null | undefined,
    fmt: string = 'EEE, MMM d',
    fallback: string = '',
): string => {
    if (shift?.shift_date) {
        const zone = shiftZone(shift);
        const d = parseZonedDateTime(shift.shift_date, shift.start_time || '00:00', zone);
        if (!isNaN(d.getTime())) return formatInTimezone(d, zone, fmt);
    }
    const d = getShiftInstant(shift, 'start');
    return d ? formatInTimezone(d, shiftZone(shift), fmt) : fallback;
};

/**
 * Format a plain calendar-date string (e.g. 'yyyy-MM-dd') for display WITHOUT any
 * timezone shift. `new Date('2026-07-13')` parses as UTC midnight and, formatted
 * with date-fns (local fields), renders the PREVIOUS day west of Greenwich. A
 * calendar date has no timezone, so parse it as a local wall-clock date — the
 * output is then the literal date in every browser tz. Full ISO instants
 * (length > 10) are rendered in the active venue's zone instead.
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
    return isNaN(d.getTime()) ? fallback : formatInTimezone(d, venueZone(), fmt);
};

/**
 * Today's calendar date as 'yyyy-MM-dd' in the given timezone (default: the
 * active venue's). Use instead of `format(new Date(), 'yyyy-MM-dd')`, which
 * yields the browser's local calendar day and is off by one near midnight for a
 * viewer outside the venue's zone.
 */
export const todayISO = (timezone: string = venueZone()): string =>
    formatInTimezone(new Date(), timezone, 'yyyy-MM-dd');

/** The shift's venue calendar date (yyyy-MM-dd) for range/bucket filtering. */
export const getShiftDateKey = (shift: ShiftTimeFields | null | undefined): string | undefined => {
    if (shift?.shift_date) return shift.shift_date;
    const d = getShiftInstant(shift, 'start');
    return d ? formatInTimezone(d, shiftZone(shift), 'yyyy-MM-dd') : undefined;
};

// --- LEGACY COMPATIBILITY ---

/**
 * @deprecated Sydney-pinned; kept only for the AutoScheduler. Use
 * getTodayInTimezone(timezone) — its default is the active venue.
 */
export const getSydneyToday = (): Date => getTodayInTimezone(SYDNEY_TZ);

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
 * Whether a wall-clock time on a date has already passed in the venue's zone
 * (default: the active venue's; pass the shift's zone when a shift is at hand).
 * Useful for locking "today's" shifts once they have started. Advisory: the
 * database decides.
 *
 * @param dateStr ISO date string (YYYY-MM-DD)
 * @param timeStr 24h time string (HH:mm)
 */
export const hasStartedInTimezone = (
    dateStr: string,
    timeStr: string,
    timezone: string = venueZone(),
): boolean => {
    if (!dateStr || !timeStr) return false;
    const shiftStart = parseZonedDateTime(dateStr, timeStr, timezone);
    const now = new Date(); // Absolute UTC comparison
    return now >= shiftStart;
};
