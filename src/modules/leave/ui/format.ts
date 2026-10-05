/** Display helpers shared by the leave pages. */
import { format, parseISO } from 'date-fns';

/** "Fri 2 Oct 2026", or "2 Oct – 6 Oct 2026" — the year once, unless it changes. */
export function formatRange(start: string, end: string): string {
    const s = parseISO(start);
    const e = parseISO(end);
    if (start === end) return format(s, 'EEE d MMM yyyy');
    return s.getFullYear() === e.getFullYear()
        ? `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`
        : `${format(s, 'd MMM yyyy')} – ${format(e, 'd MMM yyyy')}`;
}

/** Two-letter initials for an avatar fallback. */
export function initials(name: string): string {
    return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

/** Hours to one decimal, with the sign kept — "-12.8h". */
export function fmtH(n: number): string {
    return `${Math.round(n * 10) / 10}h`;
}
