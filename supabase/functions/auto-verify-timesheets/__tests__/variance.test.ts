import { describe, it, expect } from 'vitest';
import { evaluateTimesheet, isWithinAutopilotWindow, PUNCH_TOLERANCE_MIN, type TimesheetEvalInput } from '../variance';

// A shift scheduled 09:00–17:00 (Sydney) expressed as absolute instants.
const SCHED_START = Date.parse('2026-07-20T09:00:00+10:00');
const SCHED_END = Date.parse('2026-07-20T17:00:00+10:00');

// No toleranceMinutes / requireNoOvertime — tolerance is the fixed ±7.5m.
const base = (over: Partial<TimesheetEvalInput> = {}): TimesheetEvalInput => ({
    attendanceStatus: null,
    timesheetStatus: 'submitted',
    hasManualEdit: false,
    scheduledStartMs: SCHED_START,
    scheduledEndMs: SCHED_END,
    actualStartMs: SCHED_START,
    actualEndMs: SCHED_END,
    ...over,
});

const at = (isoOffsetMin: number, from: number): number => from + isoOffsetMin * 60000;

describe('evaluateTimesheet — zero-variance clean punches (fixed ±7.5m)', () => {
    it('the fixed tolerance is 7.5 minutes', () => {
        expect(PUNCH_TOLERANCE_MIN).toBe(7.5);
    });

    it('AUTO_APPROVE when punches exactly match schedule', () => {
        const r = evaluateTimesheet(base());
        expect(r.decision).toBe('AUTO_APPROVE');
        expect(r.varianceInMin).toBe(0);
        expect(r.varianceOutMin).toBe(0);
    });

    it('AUTO_APPROVE within tolerance (+3m in, -2m out)', () => {
        const r = evaluateTimesheet(base({
            actualStartMs: at(3, SCHED_START),
            actualEndMs: at(-2, SCHED_END),
        }));
        expect(r.decision).toBe('AUTO_APPROVE');
        expect(r.varianceInMin).toBe(3);
        expect(r.varianceOutMin).toBe(-2);
    });

    it('AUTO_APPROVE just inside the ±7.5m boundary (+7m)', () => {
        const r = evaluateTimesheet(base({ actualEndMs: at(7, SCHED_END) }));
        expect(r.decision).toBe('AUTO_APPROVE');
    });

    it('MANUAL_REVIEW just outside the ±7.5m boundary (+8m)', () => {
        const r = evaluateTimesheet(base({ actualEndMs: at(8, SCHED_END) }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.varianceOutMin).toBe(8);
    });

    it('MANUAL_REVIEW when clock-in variance exceeds tolerance', () => {
        const r = evaluateTimesheet(base({ actualStartMs: at(20, SCHED_START) }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.reason).toMatch(/Clock-in variance/);
    });

    it('MANUAL_REVIEW when clock-out runs long past tolerance', () => {
        const r = evaluateTimesheet(base({ actualEndMs: at(45, SCHED_END) }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.varianceOutMin).toBe(45);
    });

    it('MANUAL_REVIEW when a manager has manually edited billable times', () => {
        const r = evaluateTimesheet(base({ hasManualEdit: true }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.reason).toMatch(/manual/i);
    });

    it('MANUAL_REVIEW for a no-show', () => {
        const r = evaluateTimesheet(base({ attendanceStatus: 'no_show' }));
        expect(r.decision).toBe('MANUAL_REVIEW');
    });

    it('MANUAL_REVIEW for an auto clock-out', () => {
        const r = evaluateTimesheet(base({ attendanceStatus: 'auto_clock_out' }));
        expect(r.decision).toBe('MANUAL_REVIEW');
    });

    it('MANUAL_REVIEW when clock-out is missing', () => {
        const r = evaluateTimesheet(base({ actualEndMs: null }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.reason).toMatch(/clock-out/);
    });

    it('MANUAL_REVIEW when scheduled instants are missing', () => {
        const r = evaluateTimesheet(base({ scheduledStartMs: null }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.reason).toMatch(/scheduled/i);
    });

    it('flags alreadyFinal for an approved timesheet', () => {
        const r = evaluateTimesheet(base({ timesheetStatus: 'approved' }));
        expect(r.alreadyFinal).toBe(true);
    });

    it('flags alreadyFinal for a rejected timesheet', () => {
        const r = evaluateTimesheet(base({ timesheetStatus: 'rejected' }));
        expect(r.alreadyFinal).toBe(true);
    });

    it('honours an explicit tolerance override (test hook)', () => {
        const r = evaluateTimesheet(base({ toleranceMinutes: 30, actualStartMs: at(20, SCHED_START) }));
        expect(r.decision).toBe('AUTO_APPROVE');
    });
});

describe('isWithinAutopilotWindow — fixed 18:00–06:00 Australia/Sydney', () => {
    it('true at 20:00 Sydney (inside the window)', () => {
        // 2026-07-20 20:00 AEST (UTC+10) = 2026-07-20 10:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T10:00:00Z'))).toBe(true);
    });

    it('true at 02:00 Sydney (inside the window)', () => {
        // 2026-07-21 02:00 AEST (UTC+10) = 2026-07-20 16:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T16:00:00Z'))).toBe(true);
    });

    it('false at 12:00 Sydney (office hours)', () => {
        // 2026-07-20 12:00 AEST (UTC+10) = 2026-07-20 02:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T02:00:00Z'))).toBe(false);
    });

    it('false at 17:59 Sydney (1 min before the window opens)', () => {
        // 2026-07-20 17:59 AEST (UTC+10) = 2026-07-20 07:59 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T07:59:00Z'))).toBe(false);
    });

    it('true at 18:00 Sydney (window opens)', () => {
        // 2026-07-20 18:00 AEST (UTC+10) = 2026-07-20 08:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T08:00:00Z'))).toBe(true);
    });

    it('false at 06:00 Sydney (window closes)', () => {
        // 2026-07-21 06:00 AEST (UTC+10) = 2026-07-20 20:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-07-20T20:00:00Z'))).toBe(false);
    });

    it('handles AEDT (summer, UTC+11) — 19:00 Sydney is inside', () => {
        // 2026-01-15 19:00 AEDT (UTC+11) = 2026-01-15 08:00 UTC
        expect(isWithinAutopilotWindow(new Date('2026-01-15T08:00:00Z'))).toBe(true);
    });
});
