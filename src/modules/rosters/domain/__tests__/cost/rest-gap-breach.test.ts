import { describe, it, expect } from 'vitest';
import { detectRestGapBreaches, DEFAULT_MIN_REST_GAP_MINUTES } from '../../projections/utils/cost/rest-gap-breach';

/**
 * Regression tests for the shared cl 40.1 rest-gap breach detector —
 * compliance audit finding (2026-08-02): this logic previously existed only
 * inside the payroll period aggregator, which has no production caller, so
 * a forced early recall never triggered the double-time floor anywhere the
 * roster grid or AutoScheduler could see it.
 */

describe('detectRestGapBreaches', () => {
  it('flags a shift that resumes work with less than the 10h minimum rest gap', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00', isWorkedWithTimes: true },
      // Only 8h gap (17:00 -> next day 01:00), short of the 10h floor by 2h.
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-07', startTime: '01:00', endTime: '09:00', isWorkedWithTimes: true },
    ]);
    expect(breaches.get('s2')).toBe(120); // 2h short
    expect(breaches.has('s1')).toBe(false); // the first shift in a sequence never anchors backwards
  });

  it('does not flag a shift with a full 10h+ gap', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00', isWorkedWithTimes: true },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-07', startTime: '03:00', endTime: '11:00', isWorkedWithTimes: true }, // exactly 10h
    ]);
    expect(breaches.size).toBe(0);
  });

  it('does not check the gap between two shifts on the SAME day (split-shift/multi-hire territory)', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '06:00', endTime: '10:00', isWorkedWithTimes: true },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '10:30', endTime: '14:00', isWorkedWithTimes: true }, // 30min gap, same day
    ]);
    expect(breaches.size).toBe(0);
  });

  it('a leave/absence entry (no real times) never anchors or breaches the gap', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00', isWorkedWithTimes: true },
      { id: 'leave', employeeId: 'e1', shiftDate: '2026-07-07', isWorkedWithTimes: false }, // annual leave day
      // Gap measured from s1 (last WORKED shift), not the leave day, and s1->s3 is 34h — no breach.
      { id: 's3', employeeId: 'e1', shiftDate: '2026-07-08', startTime: '09:00', endTime: '17:00', isWorkedWithTimes: true },
    ]);
    expect(breaches.size).toBe(0);
  });

  it('never confuses two different employees\' consecutive shifts', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '23:00', isWorkedWithTimes: true },
      // A different employee working the very next hour is not e1's rest-gap concern.
      { id: 's2', employeeId: 'e2', shiftDate: '2026-07-07', startTime: '00:00', endTime: '08:00', isWorkedWithTimes: true },
    ]);
    expect(breaches.size).toBe(0);
  });

  it('respects a caller-supplied minGapMinutes override (cl 40.2 written 8h agreement)', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00', isWorkedWithTimes: true },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-07', startTime: '01:00', endTime: '09:00', isWorkedWithTimes: true }, // 8h gap
    ], 480); // 8h agreed floor
    expect(breaches.size).toBe(0);
    expect(DEFAULT_MIN_REST_GAP_MINUTES).toBe(600);
  });

  it('an overlap (negative gap) is left to the no-overlap compliance rule, not flagged here', () => {
    const breaches = detectRestGapBreaches([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '23:59', isWorkedWithTimes: true },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-07', startTime: '00:00', endTime: '08:00', isWorkedWithTimes: true },
    ]);
    // 23:59 -> next day 00:00 is a 1-minute gap, well short of 600 — still a genuine breach, not an overlap.
    expect(breaches.get('s2')).toBe(599);
  });
});
