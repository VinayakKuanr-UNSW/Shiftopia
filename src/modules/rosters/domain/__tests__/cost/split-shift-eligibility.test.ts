import { describe, it, expect } from 'vitest';
import { detectSplitShiftEligibleIds, MAX_SPLIT_SHIFT_GAP_MINUTES } from '../../projections/utils/cost/split-shift-eligibility';

/**
 * Regression tests for the shared split-shift eligibility detector (cl 39.1/
 * 39.4/28.4) — compliance audit finding (2026-08-02): this logic previously
 * existed only inside the payroll period aggregator, which has zero
 * production callers, so the cl 28.4 allowance was unreachable from the
 * roster grid / AutoScheduler / timesheets even for a genuinely eligible
 * split shift. Now shared by both.
 */

describe('detectSplitShiftEligibleIds', () => {
  it('marks only the LATER shift of a qualifying Part-Time same-day pair (≤3h gap)', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Part-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Part-Time' }, // 2h gap
    ]);
    expect(ids).toEqual(new Set(['s2']));
  });

  it('does not mark a pair whose gap exceeds the cl 39.4 3h maximum', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Part-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '14:31', endTime: '18:00', employmentType: 'Part-Time' }, // 3h31m gap
    ]);
    expect(ids.size).toBe(0);
  });

  it('marks exactly at the 3h boundary (inclusive)', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Part-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '14:00', endTime: '18:00', employmentType: 'Part-Time' }, // exactly 3h
    ]);
    expect(ids).toEqual(new Set(['s2']));
    expect(MAX_SPLIT_SHIFT_GAP_MINUTES).toBe(180);
  });

  it('excludes Casual employees (cl 39.1)', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Casual' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Casual' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('excludes Full-Time employees (cl 39.1 — Full-Time never works a "split shift" under the EBA)', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Full-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Full-Time' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('includes Flexible Part-Time employees', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Flexible Part-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Flexible Part-Time' },
    ]);
    expect(ids).toEqual(new Set(['s2']));
  });

  it('never confuses two DIFFERENT employees each working one shift on the same day', () => {
    // This is the correctness-critical difference from the payroll aggregator's
    // original (single-employee-pre-filtered) version: this detector operates
    // over a whole roster batch, so it must group by (employeeId, date).
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Part-Time' },
      { id: 's2', employeeId: 'e2', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Part-Time' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('excludes a leave/absence entry from pairing', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '11:00', employmentType: 'Part-Time', isLeave: true },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '13:00', endTime: '17:00', employmentType: 'Part-Time' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('a single shift on a day (no pair) is never marked', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '08:00', endTime: '17:00', employmentType: 'Part-Time' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('a three-way same-day pattern marks each later shift once, not the first', () => {
    const ids = detectSplitShiftEligibleIds([
      { id: 's1', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '06:00', endTime: '08:00', employmentType: 'Part-Time' },
      { id: 's2', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '10:00', endTime: '12:00', employmentType: 'Part-Time' }, // 2h gap from s1
      { id: 's3', employeeId: 'e1', shiftDate: '2026-07-06', startTime: '14:00', endTime: '17:00', employmentType: 'Part-Time' }, // 2h gap from s2
    ]);
    expect(ids).toEqual(new Set(['s2', 's3']));
  });
});
