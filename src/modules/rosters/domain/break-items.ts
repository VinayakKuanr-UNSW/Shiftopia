/**
 * Break JSON → typed rows. One parser per shape, so the roster read, the
 * Timesheets read, the shift form and the template mapper cannot drift.
 *
 *  - Scheduled breaks: `shifts.unpaid_breaks` / `template_shifts.unpaid_breaks`
 *    (jsonb, `[{ sno, start, end, duration }]`, times `HH:mm`).
 *  - Punched breaks: embedded `timesheet_breaks` rows, ordered by `break_seq`.
 */
import type { ScheduledBreakItem } from '@/modules/compliance/shape';
import type { TimesheetBreakItem } from './shift.entity';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
    typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};

/** Scheduled break windows. A non-array is no breaks. */
export function parseScheduledBreaks(raw: unknown): ScheduledBreakItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item, i) => {
        const b = asRecord(item);
        return {
            sno: typeof b.sno === 'number' ? b.sno : i + 1,
            start: typeof b.start === 'string' ? b.start.slice(0, 5) : '',
            end: typeof b.end === 'string' ? b.end.slice(0, 5) : '',
            ...(typeof b.duration === 'number' ? { duration: b.duration } : {}),
        };
    });
}

/** Punched breaks, in punch order. A non-array is no punches. */
export function parseTimesheetBreaks(raw: unknown): TimesheetBreakItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map(asRecord)
        .sort((a, b) => (Number(a.break_seq) || 0) - (Number(b.break_seq) || 0))
        .map((b) => ({
            id: String(b.id),
            timesheet_id: String(b.timesheet_id),
            shift_id: String(b.shift_id),
            break_seq: Number(b.break_seq ?? 1),
            break_start: String(b.break_start),
            break_end: b.break_end ? String(b.break_end) : null,
            duration_minutes:
                b.duration_minutes !== undefined && b.duration_minutes !== null
                    ? Number(b.duration_minutes)
                    : null,
        }));
}

/**
 * Minutes of completed punched breaks, or `null` when none were punched —
 * the zero-fallback rule: never the scheduled break.
 */
export function completedBreakMinutes(breaks: TimesheetBreakItem[]): number | null {
    const completed = breaks.filter((b) => b.break_end && b.duration_minutes !== null);
    return completed.length > 0
        ? completed.reduce((acc, b) => acc + (b.duration_minutes ?? 0), 0)
        : null;
}
