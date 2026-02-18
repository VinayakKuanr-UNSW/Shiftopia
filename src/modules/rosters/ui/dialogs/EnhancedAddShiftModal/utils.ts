import { isBefore, startOfDay, parseISO } from 'date-fns';

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

export const isDateInPast = (date: Date | undefined): boolean => {
    if (!date) return false;
    return isBefore(startOfDay(date), startOfDay(new Date()));
};

export const isShiftStarted = (date: Date | string | undefined, startTime: string | undefined): boolean => {
    if (!date || !startTime) return false;

    try {
        const [h, m] = startTime.split(':').map(Number);

        // Ensure we have a valid Date object for the base day (local day)
        let baseDate: Date;
        if (date instanceof Date) {
            baseDate = new Date(date);
        } else {
            // If it's a "YYYY-MM-DD" string, parseISO handles it locally
            baseDate = parseISO(date);
        }

        const start = new Date(baseDate);
        start.setHours(h, m, 0, 0);

        const now = new Date();
        const started = now >= start;

        if (started) {
            console.log('[isShiftStarted] TRUE', {
                date,
                startTime,
                parsedBase: baseDate.toISOString(),
                calculatedStart: start.toString(),
                now: now.toString()
            });
        }

        return started;
    } catch (e) {
        console.error('[isShiftStarted] error', e);
        return false;
    }
};
