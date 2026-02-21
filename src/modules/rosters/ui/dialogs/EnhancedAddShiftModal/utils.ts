import { isBefore, startOfDay, parseISO, format } from 'date-fns';
import { isPastInTimezone, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

export const calculateShiftLength = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let startMin = sh * 60 + sm;
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

export const formatTimeDisplay = (time: string): string => {
    if (!time) return '—';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
};

export const isDateInPast = (date: Date | undefined, timezone: string = SYDNEY_TZ): boolean => {
    if (!date) return false;
    return isPastInTimezone(date, timezone);
};

export const isShiftStarted = (date: Date | string | undefined, startTime: string | undefined, timezone: string = SYDNEY_TZ): boolean => {
    if (!date || !startTime) return false;

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

        const started = now >= shiftStart;

        if (started) {
            console.log('[isShiftStarted] TRUE', {
                dateStr,
                startTime,
                timezone,
                shiftStart: shiftStart.toISOString(),
                now: now.toISOString()
            });
        }

        return started;

    } catch (e) {
        console.error('[isShiftStarted] error', e);
        return false;
    }
};
