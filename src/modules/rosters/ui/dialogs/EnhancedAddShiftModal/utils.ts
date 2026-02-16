import { isBefore, startOfDay } from 'date-fns';

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
