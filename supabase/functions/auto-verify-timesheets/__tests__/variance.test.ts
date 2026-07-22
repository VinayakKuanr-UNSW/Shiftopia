import { describe, it, expect } from 'vitest';
import { evaluateTimesheet, type TimesheetEvalInput } from '../variance';

// A shift scheduled 09:00–17:00 (Sydney) expressed as absolute instants.
const SCHED_START = Date.parse('2026-07-20T09:00:00+10:00');
const SCHED_END = Date.parse('2026-07-20T17:00:00+10:00');

const base = (over: Partial<TimesheetEvalInput> = {}): TimesheetEvalInput => ({
    toleranceMinutes: 5,
    requireNoOvertime: true,
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

describe('evaluateTimesheet — zero-variance clean punches', () => {
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

    it('AUTO_APPROVE at exactly the tolerance boundary (+5m)', () => {
        const r = evaluateTimesheet(base({ actualEndMs: at(5, SCHED_END) }));
        expect(r.decision).toBe('AUTO_APPROVE');
    });

    it('MANUAL_REVIEW when clock-in variance exceeds tolerance', () => {
        const r = evaluateTimesheet(base({ actualStartMs: at(20, SCHED_START) }));
        expect(r.decision).toBe('MANUAL_REVIEW');
        expect(r.reason).toMatch(/Clock-in variance/);
    });

    it('MANUAL_REVIEW when clock-out runs long (overtime past tolerance)', () => {
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

    it('honours a wider tolerance from policy', () => {
        const r = evaluateTimesheet(base({ toleranceMinutes: 30, actualStartMs: at(20, SCHED_START) }));
        expect(r.decision).toBe('AUTO_APPROVE');
    });
});
