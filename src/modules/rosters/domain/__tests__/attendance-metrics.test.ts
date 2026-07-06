/**
 * attendance-metrics.test.ts
 *
 * Unit tests for the shared attendance scorecard logic used by My Attendance,
 * Timesheets, and (via the same definitions) Insights › Performance.
 *
 * All tests are pure — no mocking, no network calls.
 */

import { describe, it, expect } from 'vitest';

import {
  ATTENDANCE_GRACE_MINUTES,
  classifyAttendance,
  computeAttendanceMetrics,
  type AttendanceInput,
} from '../attendance-metrics';

const ended = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  clockInVarianceMin: 0,
  clockOutVarianceMin: 0,
  attendanceStatus: 'checked_in',
  hasEnded: true,
  ...over,
});

describe('ATTENDANCE_GRACE_MINUTES', () => {
  it('is the canonical ±7.5 min window', () => {
    expect(ATTENDANCE_GRACE_MINUTES).toBe(7.5);
  });
});

describe('classifyAttendance — in/out buckets at the grace boundary', () => {
  it('treats exactly +7.5m / -7.5m as on-time (inclusive boundary)', () => {
    const onEdge = classifyAttendance(ended({ clockInVarianceMin: 7.5, clockOutVarianceMin: -7.5 }));
    expect(onEdge.onTimeIn).toBe(true);
    expect(onEdge.lateIn).toBe(false);
    expect(onEdge.onTimeOut).toBe(true);
    expect(onEdge.earlyOut).toBe(false);
  });

  it('classifies just past the boundary as late-in / early-out', () => {
    const past = classifyAttendance(ended({ clockInVarianceMin: 8, clockOutVarianceMin: -8 }));
    expect(past.lateIn).toBe(true);
    expect(past.onTimeIn).toBe(false);
    expect(past.earlyOut).toBe(true);
    expect(past.onTimeOut).toBe(false);
  });

  it('classifies early-in and late-out', () => {
    const f = classifyAttendance(ended({ clockInVarianceMin: -30, clockOutVarianceMin: 30 }));
    expect(f.earlyIn).toBe(true);
    expect(f.lateOut).toBe(true);
  });
});

describe('classifyAttendance — worked / no-show / auto-clock-out', () => {
  it('counts a no-show, never as worked', () => {
    const f = classifyAttendance(ended({ attendanceStatus: 'no_show', clockInVarianceMin: null, clockOutVarianceMin: null }));
    expect(f.noShow).toBe(true);
    expect(f.worked).toBe(false);
  });

  it('counts auto-clock-out as a worked shift', () => {
    const f = classifyAttendance(ended({ attendanceStatus: 'auto_clock_out' }));
    expect(f.autoClockOut).toBe(true);
    expect(f.worked).toBe(true);
  });

  it('does not count a shift that has not ended yet as worked', () => {
    const f = classifyAttendance(ended({ hasEnded: false }));
    expect(f.worked).toBe(false);
  });

  it('counts an attended shift as worked even without a recognised status', () => {
    const f = classifyAttendance(ended({ attendanceStatus: null, clockInVarianceMin: 2 }));
    expect(f.worked).toBe(true);
  });
});

describe('computeAttendanceMetrics — denominators and percentages', () => {
  it('uses worked as the denominator for in/out + auto-clock-out, held for no-show', () => {
    const inputs: AttendanceInput[] = [
      // 4 worked shifts:
      ended({ clockInVarianceMin: 0, clockOutVarianceMin: 0 }),            // on-time in & out
      ended({ clockInVarianceMin: 20, clockOutVarianceMin: 0 }),           // late in
      ended({ clockInVarianceMin: -20, clockOutVarianceMin: 40 }),         // early in, late out
      ended({ attendanceStatus: 'auto_clock_out', clockInVarianceMin: 0, clockOutVarianceMin: -60 }), // auto out, early out
      // 1 no-show:
      ended({ attendanceStatus: 'no_show', clockInVarianceMin: null, clockOutVarianceMin: null }),
    ];

    const m = computeAttendanceMetrics(inputs);

    expect(m.workedCount).toBe(4);
    expect(m.noShowCount).toBe(1);
    expect(m.heldCount).toBe(5);

    // In buckets (denominator = worked = 4)
    expect(m.lateClockInPct).toBe(25);   // 1/4
    expect(m.earlyClockInPct).toBe(25);  // 1/4
    expect(m.onTimeInPct).toBe(50);      // 2/4

    // Out buckets (denominator = worked = 4)
    expect(m.lateClockOutPct).toBe(25);  // 1/4
    expect(m.earlyClockOutPct).toBe(25); // 1/4
    expect(m.onTimeOutPct).toBe(50);     // 2/4

    // Auto-clock-out (denominator = worked = 4)
    expect(m.autoClockOutPct).toBe(25);  // 1/4

    // No-show (denominator = held = 5)
    expect(m.noShowPct).toBe(20);        // 1/5
  });

  it('returns all-zero percentages for an empty set (no division by zero)', () => {
    const m = computeAttendanceMetrics([]);
    expect(m.workedCount).toBe(0);
    expect(m.onTimeInPct).toBe(0);
    expect(m.noShowPct).toBe(0);
    expect(m.autoClockOutPct).toBe(0);
  });

  it('ignores missing clock times when bucketing worked shifts', () => {
    const inputs: AttendanceInput[] = [
      ended({ clockInVarianceMin: 0, clockOutVarianceMin: null }), // worked, no clock-out recorded
    ];
    const m = computeAttendanceMetrics(inputs);
    expect(m.workedCount).toBe(1);
    expect(m.onTimeInPct).toBe(100);  // 1/1
    expect(m.onTimeOutPct).toBe(0);   // no out clock → no out bucket
    expect(m.lateClockOutPct).toBe(0);
  });
});
