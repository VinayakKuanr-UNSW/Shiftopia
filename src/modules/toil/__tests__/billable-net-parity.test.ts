/**
 * PARITY PIN — SQL `internal.toil_billable_net_minutes` vs the TypeScript
 * billable rule (`timesheets/domain/billable-time.ts`, composed the way Gross
 * Pay composes it).
 *
 * TOIL is accrued in the database from approved timesheets, but Gross Pay and
 * the timesheet screen work out billable time in TypeScript. If the two ever
 * disagree, someone is banked time they were not paid for (or the reverse).
 * The `sql` column below is what the live function returned for each case
 * (captured from production, 2026-10-10, with the same `now`). Change either
 * side and this fails until the other matches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    calculateNetMinutes,
    isShiftFinished,
    resolveBillableSide,
} from '@/modules/timesheets/domain/billable-time';

interface Case {
    name: string;
    manualStart: string | null;
    manualEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    shiftDate: string;
    schedStart: string;
    schedEnd: string;
    tsBreak: number | null;
    shiftBreak: number | null;
    now: string;
    sql: number | null;
}

const CASES: Case[] = [
    { name: 'manual both', manualStart: '09:00:00', manualEnd: '17:30:00', actualStart: null, actualEnd: null, shiftDate: '2026-09-25', schedStart: '09:00:00', schedEnd: '17:30:00', tsBreak: 30, shiftBreak: 45, now: '2026-10-01T00:00:00+10:00', sql: 480 },
    { name: 'snapped both', manualStart: null, manualEnd: null, actualStart: '2026-09-25T07:52:29+10:00', actualEnd: '2026-09-25T16:07:30+10:00', shiftDate: '2026-09-25', schedStart: '08:00:00', schedEnd: '16:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: 480 },
    { name: 'half-quarter rounds up', manualStart: null, manualEnd: null, actualStart: '2026-09-25T09:07:30+10:00', actualEnd: '2026-09-25T17:22:30+10:00', shiftDate: '2026-09-25', schedStart: '09:00:00', schedEnd: '17:00:00', tsBreak: 0, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: 495 },
    { name: 'seconds count', manualStart: null, manualEnd: null, actualStart: '2026-09-25T08:07:59+10:00', actualEnd: '2026-09-25T16:52:00+10:00', shiftDate: '2026-09-25', schedStart: '08:00:00', schedEnd: '17:00:00', tsBreak: null, shiftBreak: 0, now: '2026-10-01T00:00:00+10:00', sql: 510 },
    { name: '23:53 wraps to 00:00', manualStart: '16:00:00', manualEnd: null, actualStart: '2026-09-25T16:00:00+10:00', actualEnd: '2026-09-25T23:53:00+10:00', shiftDate: '2026-09-25', schedStart: '16:00:00', schedEnd: '00:00:00', tsBreak: null, shiftBreak: 0, now: '2026-10-01T00:00:00+10:00', sql: 480 },
    { name: 'overnight manual', manualStart: '22:00:00', manualEnd: '06:00:00', actualStart: null, actualEnd: null, shiftDate: '2026-09-25', schedStart: '22:00:00', schedEnd: '06:00:00', tsBreak: 30, shiftBreak: 0, now: '2026-10-01T00:00:00+10:00', sql: 450 },
    { name: 'not finished', manualStart: null, manualEnd: null, actualStart: '2026-10-01T08:00:00+10:00', actualEnd: null, shiftDate: '2026-10-01', schedStart: '08:00:00', schedEnd: '16:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T12:00:00+10:00', sql: null },
    { name: 'not finished, manual', manualStart: '08:00:00', manualEnd: '12:00:00', actualStart: '2026-10-01T08:00:00+10:00', actualEnd: null, shiftDate: '2026-10-01', schedStart: '08:00:00', schedEnd: '16:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T12:00:00+10:00', sql: 210 },
    { name: 'missing clock-out', manualStart: null, manualEnd: null, actualStart: '2026-09-25T08:00:00+10:00', actualEnd: null, shiftDate: '2026-09-25', schedStart: '08:00:00', schedEnd: '16:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: null },
    { name: 'timesheet break 0 wins', manualStart: null, manualEnd: null, actualStart: '2026-09-25T08:00:00+10:00', actualEnd: '2026-09-25T16:30:00+10:00', shiftDate: '2026-09-25', schedStart: '08:00:00', schedEnd: '16:30:00', tsBreak: 0, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: 510 },
    { name: 'DST start wall clock', manualStart: null, manualEnd: null, actualStart: '2026-10-04T01:00:00+10:00', actualEnd: '2026-10-04T09:00:00+11:00', shiftDate: '2026-10-04', schedStart: '01:00:00', schedEnd: '09:00:00', tsBreak: null, shiftBreak: 0, now: '2026-10-05T00:00:00+11:00', sql: 480 },
    { name: 'equal start and end', manualStart: '10:00:00', manualEnd: '10:00:00', actualStart: null, actualEnd: null, shiftDate: '2026-09-25', schedStart: '10:00:00', schedEnd: '11:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: 0 },
    { name: 'break longer than span', manualStart: '10:00:00', manualEnd: '10:20:00', actualStart: null, actualEnd: null, shiftDate: '2026-09-25', schedStart: '10:00:00', schedEnd: '11:00:00', tsBreak: 30, shiftBreak: 0, now: '2026-10-01T00:00:00+10:00', sql: 0 },
    { name: 'finished by schedule, no punch at all', manualStart: null, manualEnd: null, actualStart: null, actualEnd: null, shiftDate: '2026-09-25', schedStart: '08:00:00', schedEnd: '16:00:00', tsBreak: null, shiftBreak: 30, now: '2026-10-01T00:00:00+10:00', sql: null },
];

/** The TypeScript side, composed exactly as `grossPay.read.api.ts` does. */
function tsBillableNet(c: Case): number | null {
    const finished = isShiftFinished(c.shiftDate, c.schedStart, c.schedEnd, c.actualEnd);
    const start = resolveBillableSide(c.manualStart, c.actualStart, finished);
    const end = resolveBillableSide(c.manualEnd, c.actualEnd, finished);
    const unpaidBreak = c.tsBreak != null ? c.tsBreak : (c.shiftBreak || 0);
    return calculateNetMinutes(start, end, unpaidBreak);
}

describe('billable net — SQL (TOIL accrual) ≡ TypeScript (Gross Pay)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it.each(CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
        vi.setSystemTime(new Date(c.now));
        expect(tsBillableNet(c)).toBe(c.sql);
    });
});
