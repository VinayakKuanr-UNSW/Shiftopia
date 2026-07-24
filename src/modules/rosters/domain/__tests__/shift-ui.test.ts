import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTimeRule, getLiveRule, getLiveRuleBadges, getPayrollRuleBadges, isTimesheetReviewable } from '../shift-ui';
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

// ─── Time Rules ────────────────────────────────────────────────────────────────

describe('getTimeRule - 5-state schedule lifecycle', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;

    it('Standard when start is more than 24h away', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+30 * HOUR), end_at: iso(+38 * HOUR) }))
            .toEqual({ label: 'Standard', color: '#3B82F6' });
    });

    it('Urgent when start is between 4h and 24h away', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+10 * HOUR), end_at: iso(+18 * HOUR) })?.label)
            .toBe('Urgent');
    });

    it('Emergent when start is within 4h', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+2 * HOUR), end_at: iso(+10 * HOUR) })?.label)
            .toBe('Emergent');
    });

    it('Live when now is between start and end', () => {
        expect(getTimeRule({ lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+2 * HOUR) })?.label)
            .toBe('Live');
    });

    it('Closed when now is after end', () => {
        expect(getTimeRule({ lifecycle_status: 'Completed', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('Closed when clocked out early, even though still inside the scheduled window', () => {
        // Worker clocked out (actual_end set) an hour into an 8h shift — must not read Live.
        expect(getTimeRule({ lifecycle_status: 'Completed', start_at: iso(-1 * HOUR), end_at: iso(+7 * HOUR), actual_end: iso(-0.5 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('Closed when Completed inside the scheduled window (no clock-out recorded)', () => {
        expect(getTimeRule({ lifecycle_status: 'Completed', start_at: iso(-1 * HOUR), end_at: iso(+7 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('Closed when cancelled inside the scheduled window', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', is_cancelled: true, start_at: iso(-1 * HOUR), end_at: iso(+7 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('returns null when the start time is unparseable', () => {
        expect(getTimeRule({ lifecycle_status: 'Published' })).toBeNull();
    });

    it('Live when clocked in early, even though now is before the scheduled start time', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+1 * HOUR), end_at: iso(+9 * HOUR), actual_start: iso(-0.1 * HOUR) })?.label)
            .toBe('Live');
    });

    it('Closed when auto clocked out', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(-5 * HOUR), end_at: iso(+3 * HOUR), attendance_status: 'auto_clock_out' })?.label)
            .toBe('Closed');
    });

    it('does NOT treat actual_end "-" as Closed', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(+5 * HOUR), end_at: iso(+13 * HOUR), actual_end: '-' })?.label)
            .not.toBe('Closed');
    });
});

// ─── Live Rules ────────────────────────────────────────────────────────────────

describe('getLiveRuleBadges - two-badge arrival/departure model', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    const arrival = (s: Parameters<typeof getLiveRuleBadges>[0]) => getLiveRuleBadges(s).arrival?.label;
    const departure = (s: Parameters<typeof getLiveRuleBadges>[0]) => getLiveRuleBadges(s).departure?.label;

    // ── Pre-shift: arrival stand-in only, no departure ──────────────────────────
    it('Scheduled when upcoming and clock-in window not yet open', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(+5 * HOUR), end_at: iso(+13 * HOUR) };
        expect(arrival(s)).toBe('Scheduled');
        expect(departure(s)).toBeUndefined();
    });

    it('Awaiting Check-In when clock-in window open and not checked in', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(+30 * MIN), end_at: iso(+8 * HOUR) };
        expect(arrival(s)).toBe('Awaiting Check-In');
        expect(departure(s)).toBeUndefined();
    });

    // ── During shift: arrival quality, departure null until they leave ──────────
    it('Missing when shift started, no clock-in, not yet ended', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(-30 * MIN), end_at: iso(+4 * HOUR) };
        expect(arrival(s)).toBe('Missing');
        expect(departure(s)).toBeUndefined();
    });

    it('Early In with no departure while clocked in mid-shift', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR - 20 * MIN) };
        expect(arrival(s)).toBe('Early In');
        expect(departure(s)).toBeUndefined();
    });

    it('On Time In persists mid-shift when clocked in within grace', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 2 * MIN) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBeUndefined();
    });

    it('Late In persists mid-shift (arrival quality is kept)', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 20 * MIN) };
        expect(arrival(s)).toBe('Late In');
        expect(departure(s)).toBeUndefined();
    });

    // ── Completed: both halves present ──────────────────────────────────────────
    it('On Time In + On Time Out for a clean shift', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 1 * MIN), actual_end: iso(-1 * HOUR + 2 * MIN) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('On Time Out');
    });

    it('Late In + Early Out preserves both halves (no information lost)', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-2 * HOUR) };
        expect(arrival(s)).toBe('Late In');
        expect(departure(s)).toBe('Early Out');
    });

    it('Early In + Late Out for an over-committed shift', () => {
        const s = { lifecycle_status: 'Completed', start_at: iso(-9 * HOUR), end_at: iso(-2 * HOUR),
            actual_start: iso(-9 * HOUR - 15 * MIN), actual_end: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('Early In');
        expect(departure(s)).toBe('Late Out');
    });

    // ── Exceptional ─────────────────────────────────────────────────────────────
    it('No Show carries an arrival badge and no departure', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('No Show');
        expect(departure(s)).toBeUndefined();
    });

    it('Working Overtime departure when clocked in, past end, before auto threshold', () => {
        const s = { lifecycle_status: 'InProgress', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-9 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Working Overtime');
    });

    it('Auto Clock-Out departure wins on attendance_status flag', () => {
        const s = { lifecycle_status: 'Completed', attendance_status: 'auto_clock_out',
            start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), actual_start: iso(-13 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Auto Clock-Out');
    });

    // ── Per-side manual overrides ───────────────────────────────────────────────
    it('editing only the In stars the arrival — departure keeps its actual-clock rule', () => {
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed',
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 2 * MIN), actual_end: iso(-1 * HOUR + 1 * MIN),
            adjusted_start: iso(-8 * HOUR + 20 * MIN), adjusted_end: iso(-1 * HOUR + 1 * MIN),
            adjusted_start_is_manual: true, adjusted_end_is_manual: false });
        expect(badges.arrival?.label).toBe('Late In*');
        expect(badges.departure?.label).toBe('On Time Out'); // no star
    });

    it('editing only the Out stars the departure — arrival keeps its actual-clock rule', () => {
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed',
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 2 * MIN), actual_end: iso(-1 * HOUR + 1 * MIN),
            adjusted_start: iso(-8 * HOUR + 2 * MIN), adjusted_end: iso(-2 * HOUR),
            adjusted_start_is_manual: false, adjusted_end_is_manual: true });
        expect(badges.arrival?.label).toBe('On Time In'); // no star
        expect(badges.departure?.label).toBe('Early Out*');
    });

    it('manual In override applies even when there is no adjusted/actual end (overridden no-show)', () => {
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed', attendance_status: 'no_show',
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            adjusted_start: iso(-8 * HOUR + 1 * MIN),
            adjusted_start_is_manual: true, adjusted_end_is_manual: false });
        expect(badges.arrival?.label).toBe('On Time In*');
        expect(badges.departure).toBeNull();
    });

    // ── Auto clock-out horizon = LATER of clock-in and scheduled start ─────────
    it('late clock-in extends Working Overtime past start + 12.5h', () => {
        // start 13h ago, clocked in 1h late (12h ago) → horizon = clock-in + 12.5h
        // = 30 min from now, so the employee is still Working Overtime.
        const s = { lifecycle_status: 'Completed', attendance_status: 'checked_in',
            start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), actual_start: iso(-12 * HOUR) };
        expect(departure(s)).toBe('Working Overtime');
        expect(isTimesheetReviewable(s)).toBe(false); // overtime is non-terminal
    });

    it('early clock-in anchors the horizon to scheduled start (whichever is later)', () => {
        // clocked in 1h early, start 13h ago → horizon = start + 12.5h = 30 min
        // ago... auto clock-out should already have fired server-side; client
        // shows no overtime badge past the horizon.
        const s = { lifecycle_status: 'Completed', attendance_status: 'checked_in',
            start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), actual_start: iso(-14 * HOUR) };
        expect(departure(s)).toBeUndefined();
    });

    it('legacy both-sides flag re-derives both halves with a * suffix', () => {
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed', attendance_status: 'no_show',
            adjusted_is_manual: true,
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            adjusted_start: iso(-8 * HOUR + 20 * MIN), adjusted_end: iso(-2 * HOUR) });
        expect(badges.arrival?.label).toBe('Late In*');
        expect(badges.departure?.label).toBe('Early Out*');
    });

    it('auto/snapped billable times do NOT get a * (no manual override)', () => {
        // adjusted times present but not manually committed → derive from actual clock punches
        const badges = getLiveRuleBadges({ lifecycle_status: 'Completed',
            adjusted_is_manual: false,
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 2 * MIN), actual_end: iso(-1 * HOUR + 1 * MIN),
            adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR) });
        expect(badges.arrival?.label).toBe('On Time In');
        expect(badges.departure?.label).toBe('On Time Out');
    });

    it('returns both null when the start time is unparseable', () => {
        expect(getLiveRuleBadges({ lifecycle_status: 'Published' })).toEqual({ arrival: null, departure: null });
    });
});

describe('getPayrollRuleBadges - billable-window two-badge model', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;
    // Scheduled 8h ago → 1h ago.
    const sched = { lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR) };
    const arrival = (s: Parameters<typeof getPayrollRuleBadges>[0]) => getPayrollRuleBadges(s).arrival?.label;
    const departure = (s: Parameters<typeof getPayrollRuleBadges>[0]) => getPayrollRuleBadges(s).departure?.label;

    it('On Roster + On Roster when billable matches the roster', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('On Roster');
        expect(departure(s)).toBe('On Roster');
    });

    it('Overtime when the billable OUT runs past the rostered end', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR + 40 * MIN) };
        expect(departure(s)).toBe('Overtime');
    });

    it('Short when the billable OUT falls before the rostered end', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-2 * HOUR) };
        expect(departure(s)).toBe('Short');
    });

    it('Paid Early / Late Start on the IN side', () => {
        expect(arrival({ ...sched, adjusted_start: iso(-8 * HOUR - 30 * MIN) })).toBe('Paid Early');
        expect(arrival({ ...sched, adjusted_start: iso(-8 * HOUR + 30 * MIN) })).toBe('Late Start');
    });

    it('no badge for a side with no resolvable billable time', () => {
        // Auto clock-out / no-show: no billable OUT → no departure badge (never fabricated).
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: null };
        expect(arrival(s)).toBe('On Roster');
        expect(getPayrollRuleBadges(s).departure).toBeNull();
    });

    it('DIVERGES from Live Rules: late actual clock-in but on-roster billable', () => {
        // Actual clock-in 20m late (Live: Late In) but billable snapped to the roster.
        const s = {
            ...sched,
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-1 * HOUR + 2 * MIN),
            adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR),
        };
        expect(getLiveRuleBadges(s).arrival?.label).toBe('Late In');   // attendance truth
        expect(getPayrollRuleBadges(s).arrival?.label).toBe('On Roster'); // what we pay
    });

    it('returns both null when the schedule is unparseable', () => {
        expect(getPayrollRuleBadges({ lifecycle_status: 'Completed' })).toEqual({ arrival: null, departure: null });
    });
});

describe('getLiveRule - single-badge adapter (departure wins over arrival)', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    it('surfaces the departure half once the employee has left', () => {
        expect(getLiveRule({ lifecycle_status: 'Completed', start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-2 * HOUR) })?.label).toBe('Early Out');
    });

    it('falls back to the arrival half mid-shift', () => {
        expect(getLiveRule({ lifecycle_status: 'InProgress', start_at: iso(-1 * HOUR), end_at: iso(+3 * HOUR),
            actual_start: iso(-1 * HOUR + 20 * MIN) })?.label).toBe('Late In');
    });

    it('keeps the * suffix so manual overrides are still detectable', () => {
        expect(getLiveRule({ lifecycle_status: 'Completed', attendance_status: 'no_show',
            adjusted_is_manual: true, start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            adjusted_start: iso(-8 * HOUR + 2 * MIN), adjusted_end: iso(-1 * HOUR + 2 * MIN) })?.label.endsWith('*'))
            .toBe(true);
    });
});

// ─── Overnight shifts (time-only fallback, no start_at/end_at) ────────────────

describe('overnight shifts via shift_date + times fallback', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    // 22:00 → 06:00 Sydney shift; "now" pinned mid-shift at 02:00 the next day.
    const overnight = { lifecycle_status: 'Published', shift_date: '2026-01-10',
        start_time: '22:00:00', end_time: '06:00:00' };
    const midShift = parseZonedDateTime('2026-01-11', '02:00');

    it('Time Rule stays Live mid-shift (end rolls over to the next day)', () => {
        vi.setSystemTime(midShift);
        expect(getTimeRule(overnight)?.label).toBe('Live');
    });

    it('Live Rule shows Missing (not No Show) mid-shift with no clock-in', () => {
        vi.setSystemTime(midShift);
        expect(getLiveRuleBadges(overnight).arrival?.label).toBe('Missing');
    });

    it('review stays locked mid-shift, unlocks after the (rolled-over) end', () => {
        vi.setSystemTime(midShift);
        expect(isTimesheetReviewable(overnight)).toBe(false);
        vi.setSystemTime(parseZonedDateTime('2026-01-11', '06:05'));
        expect(isTimesheetReviewable(overnight)).toBe(true); // No Show stand-in
    });
});
