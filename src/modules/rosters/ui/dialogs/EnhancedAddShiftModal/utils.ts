import { format } from 'date-fns';
import { isPastInTimezone, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import type { Role } from './types';

/**
 * The level a new shift of this role starts at: the role's default level, else
 * the bottom of its EA band, else none. Level 0 is a real level, so this tests
 * for null rather than truthiness.
 */
export const defaultShiftLevel = (role: Role | undefined): number | null =>
    role?.remuneration_level ?? role?.eba_level_min ?? null;

export const calculateShiftLength = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (endMin <= startMin) endMin += 24 * 60;
    return (endMin - startMin) / 60;
};

export const formatHours = (h: number): string => {
    if (!h || h === 0) return '—';
    const hours = Math.floor(h);
    const mins = Math.round((h - hours) * 60);
    return `${hours}h ${mins}m`;
};


export const isDateInPast = (date: Date | undefined, timezone: string = SYDNEY_TZ): boolean => {
    if (!date) return false;
    return isPastInTimezone(date, timezone);
};

export const isShiftStarted = (date: Date | string | undefined, startTime: string | undefined, timezone: string = SYDNEY_TZ): boolean => {
    if (!date || !startTime) return false;

    // Guard: Only validate if we have a complete "HH:MM" format (4-5 chars with a colon)
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(startTime)) return false;

    try {
        // 1. Get the date string (YYYY-MM-DD)
        let dateStr: string;
        if (date instanceof Date) {
            dateStr = format(date, 'yyyy-MM-dd');
        } else {
            // Assume string is YYYY-MM-DD
            dateStr = date.split('T')[0];
        }

        // 2. Parse into absolute timestamp for the target timezone
        const shiftStart = parseZonedDateTime(dateStr, startTime, timezone);

        // 3. Compare with absolute "now"
        const now = new Date(); // Absolute now

        return now >= shiftStart;

    } catch (e) {
        console.error('[isShiftStarted] error', e);
        return false;
    }
};

/**
 * Why a NEW roster shift cannot be saved at this start, or null. A start that
 * has passed — an earlier day, or earlier today — is refused by the database
 * (trg_shift_not_started). Editing an existing shift is governed by the
 * read-only rules, and a template shift has a weekday rather than a date.
 */
export const newShiftStartRefusal = (input: {
    editMode: boolean;
    isTemplateMode: boolean;
    date: Date | undefined;
    startTime: string | undefined;
    timezone?: string;
}): string | null => {
    if (input.editMode || input.isTemplateMode) return null;
    const passed = isDateInPast(input.date, input.timezone)
        || isShiftStarted(input.date, input.startTime, input.timezone);
    return passed ? 'This start time has already passed' : null;
};
