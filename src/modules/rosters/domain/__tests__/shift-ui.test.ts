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

    it('Closed when unassigned and past scheduled end, even though still Published/InProgress and well inside 12.5h-from-start', () => {
        // Reproduces the reported bug: an unassigned, never-clocked-in shift whose
        // 5h window ended an hour ago must not still read Live for another ~11.5h.
        expect(getTimeRule({ lifecycle_status: 'Published', start_at: iso(-6 * HOUR), end_at: iso(-1 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('Closed when attendance_status is no_show, even before the 12.5h-from-start horizon', () => {
        expect(getTimeRule({ lifecycle_status: 'Published', attendance_status: 'no_show', start_at: iso(-2 * HOUR), end_at: iso(+1 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('auto-clockout anchor does not fire early for an early clock-in (matches pre-fix behavior)', () => {
        // Long (24h) shift so scheduled end is still in the future — isolates the
        // 12.5h-from-anchor check from the end-time check.
        // actual_start 1h before scheduled start; anchor = GREATEST(ci, start) = start.
        // Just before start + 12.5h it must still be Live...
        expect(getTimeRule({ lifecycle_status: 'InProgress', start_at: iso(-12.4 * HOUR), end_at: iso(+10 * HOUR), actual_start: iso(-13.4 * HOUR) })?.label)
            .toBe('Live');
        // ...and Closed once past start + 12.5h.
        expect(getTimeRule({ lifecycle_status: 'InProgress', start_at: iso(-12.6 * HOUR), end_at: iso(+10 * HOUR), actual_start: iso(-13.6 * HOUR) })?.label)
            .toBe('Closed');
    });

    it('auto-clockout anchor extends for a late clock-in past the old flat start+12.5h horizon', () => {
        // Long (24h) shift so scheduled end is still in the future. start was 13h
        // ago (old flat horizon of start+12.5h has already passed), but actual_start
        // was 2h after start, so the GREATEST anchor is start+2h, meaning the 12.5h
        // horizon is still 1.5h away — must still read Live.
        expect(getTimeRule({ lifecycle_status: 'InProgress', start_at: iso(-13 * HOUR), end_at: iso(+10 * HOUR), actual_start: iso(-11 * HOUR) })?.label)
            .toBe('Live');
    });

    it('Time Rules and Payroll Rules agree on the reported bug scenario', () => {
        const shift = { lifecycle_status: 'Published', start_at: iso(-6 * HOUR), end_at: iso(-1 * HOUR) };
        expect(getTimeRule(shift)?.label).toBe('Closed');
        expect(getPayrollRuleBadges(shift).arrival?.label).toBe('No Show');
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

    it('Shift past end before 12.5h mark reads Working Overtime', () => {
        const s = { lifecycle_status: 'InProgress', attendance_status: 'checked_in',
            start_at: iso(-6 * HOUR), end_at: iso(-1 * HOUR), actual_start: iso(-6 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Working Overtime');
    });

    it('Shift at or past 12.5h from start without clock-out reads Missing departure', () => {
        const s = { lifecycle_status: 'Completed', attendance_status: 'checked_in',
            start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), actual_start: iso(-13 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('Missing');
    });

    it('auto/snapped billable times do NOT alter raw actual clocking live rules', () => {
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

    it('On Time In + On Time Out when billable matches the roster', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR) };
        expect(arrival(s)).toBe('On Time In');
        expect(departure(s)).toBe('On Time Out');
    });

    it('Late Out when the billable OUT runs past the rostered end', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR + 40 * MIN) };
        expect(departure(s)).toBe('Late Out');
    });

    it('Early Out when the billable OUT falls before the rostered end', () => {
        const s = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-2 * HOUR) };
        expect(departure(s)).toBe('Early Out');
    });

    it('Early In / Late In on the IN side', () => {
        expect(arrival({ ...sched, adjusted_start: iso(-8 * HOUR - 30 * MIN) })).toBe('Early In');
        expect(arrival({ ...sched, adjusted_start: iso(-8 * HOUR + 30 * MIN) })).toBe('Late In');
    });

    it('returns Missing departure for unadjusted end on an ended shift', () => {
        const sMid = { ...sched, adjusted_start: iso(-8 * HOUR), adjusted_end: null };
        expect(arrival(sMid)).toBe('On Time In');
        expect(getPayrollRuleBadges(sMid).departure?.label).toBe('Missing');

        const sLate = { lifecycle_status: 'Completed', start_at: iso(-13 * HOUR), end_at: iso(-5 * HOUR), adjusted_start: iso(-13 * HOUR), adjusted_end: null };
        expect(getPayrollRuleBadges(sLate).departure?.label).toBe('Missing');
    });

    it('returns No Show arrival and null departure when both billable sides are missing on an ended shift', () => {
        const sNoShow = { ...sched, adjusted_start: null, adjusted_end: null };
        expect(getPayrollRuleBadges(sNoShow).arrival?.label).toBe('No Show');
        expect(getPayrollRuleBadges(sNoShow).departure).toBeNull();
    });

    it('mirrors Live Rules labels but from billable times', () => {
        // Actual clock-in 20m late (Live: Late In) but billable snapped to the roster.
        const s = {
            ...sched,
            actual_start: iso(-8 * HOUR + 20 * MIN), actual_end: iso(-1 * HOUR + 2 * MIN),
            adjusted_start: iso(-8 * HOUR), adjusted_end: iso(-1 * HOUR),
        };
        expect(getLiveRuleBadges(s).arrival?.label).toBe('Late In');      // attendance truth
        expect(getPayrollRuleBadges(s).arrival?.label).toBe('On Time In'); // billable truth (same label vocabulary)
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

    it('surfaces actual clocking rule via getLiveRule', () => {
        expect(getLiveRule({ lifecycle_status: 'Completed',
            start_at: iso(-8 * HOUR), end_at: iso(-1 * HOUR),
            actual_start: iso(-8 * HOUR + 2 * MIN), actual_end: iso(-1 * HOUR + 2 * MIN) })?.label)
            .toBe('On Time Out');
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

describe('unassigned shifts never accrue attendance', () => {
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const HOUR = 60 * 60 * 1000;

    // A shift whose scheduled window has fully passed — the condition that used
    // to synthesise "No Show" from nothing but the clock.
    const finishedWindow = { lifecycle_status: 'Published', start_at: iso(-9 * HOUR), end_at: iso(-1 * HOUR) };

    it('reports No Show for an ASSIGNED shift nobody clocked into', () => {
        const s = { ...finishedWindow, assigned_employee_id: 'emp-1', assignment_status: 'assigned' };
        expect(getLiveRuleBadges(s).arrival?.label).toBe('No Show');
        expect(getPayrollRuleBadges(s).arrival?.label).toBe('No Show');
    });

    it('reports NOTHING for an unassigned shift — nobody was rostered to show up', () => {
        const s = { ...finishedWindow, assigned_employee_id: null, assignment_status: 'unassigned' };
        expect(getLiveRuleBadges(s)).toEqual({ arrival: null, departure: null });
        expect(getPayrollRuleBadges(s)).toEqual({ arrival: null, departure: null });
    });

    it('treats a null assigned_employee_id as unassigned even without assignment_status', () => {
        const s = { ...finishedWindow, assigned_employee_id: null };
        expect(getLiveRuleBadges(s).arrival).toBeNull();
        expect(getPayrollRuleBadges(s).arrival).toBeNull();
    });

    it('still closes the schedule window — Time Rules describe the SLOT, not a person', () => {
        const s = { ...finishedWindow, assigned_employee_id: null, assignment_status: 'unassigned' };
        expect(getTimeRule(s)?.label).toBe('Closed');
    });

    it('keeps badges for legacy callers that supply no assignment fields at all', () => {
        expect(getLiveRuleBadges(finishedWindow).arrival?.label).toBe('No Show');
    });

    it('does not suppress a mid-shift unassigned slot into a false Missing', () => {
        const s = { lifecycle_status: 'Published', start_at: iso(-30 * 60 * 1000), end_at: iso(+4 * HOUR),
            assigned_employee_id: null, assignment_status: 'unassigned' };
        expect(getLiveRuleBadges(s).arrival).toBeNull();
    });
});
