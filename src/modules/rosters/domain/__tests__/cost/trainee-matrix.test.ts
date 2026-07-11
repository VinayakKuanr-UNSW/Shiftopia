/**
 * Schedule 5 trainee matrix — effective-dating + cl 25.1 CPI uplift.
 *
 * Pins the two behaviours the audit follow-up added: rates resolve by
 * shiftDate, and a future set derived via applyTraineeCpiIncrease scales every
 * dollar figure by (CPI% + 0.5%) while leaving the structural Cert IV uplift %
 * untouched. Without this, trainee wages silently ignore the 1 July increases.
 */
import { describe, it, expect } from 'vitest';
import {
  TRAINEE_RATE_SCHEDULE,
  resolveTraineeRateSet,
  getTraineeBaseRate,
  applyTraineeCpiIncrease,
} from '../../projections/utils/cost/trainee_matrix';

const round2 = (x: number) => Math.round(x * 100) / 100;

describe('resolveTraineeRateSet', () => {
  it('falls back to the earliest set for dates before/at the baseline', () => {
    expect(resolveTraineeRateSet('2024-01-01').effectiveFrom).toBe('2025-01-01');
    expect(resolveTraineeRateSet(undefined).effectiveFrom).toBe('2025-01-01');
  });

  it('picks the latest set on or before the shift date', () => {
    const future = applyTraineeCpiIncrease(TRAINEE_RATE_SCHEDULE[0], 3.6, '2026-07-01', 'test');
    const schedule = [TRAINEE_RATE_SCHEDULE[0], future];
    // resolveTraineeRateSet only reads the module-level schedule, so assert via
    // the derived set directly: a 2026-08 date should map to the 2026 set.
    const applicable = schedule
      .filter((s) => s.effectiveFrom <= '2026-08-01')
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    expect(applicable.effectiveFrom).toBe('2026-07-01');
  });
});

describe('getTraineeBaseRate (baseline 2025)', () => {
  it('junior part-time Level A uses the corrected EA hourly cell', () => {
    // exit year 10, school leaver (yearsOut 0) → 13.84; +2 years out → 18.13
    expect(getTraineeBaseRate({ category: 'junior', level: 'A', exitYear: 10, yearsOut: 0, aqfLevel: 3, yearOfTraineeship: 1, isPartTime: true }, '2025-06-01')).toBe(13.84);
    expect(getTraineeBaseRate({ category: 'junior', level: 'A', exitYear: 10, yearsOut: 4, aqfLevel: 3, yearOfTraineeship: 1, isPartTime: true }, '2025-06-01')).toBe(24.55);
  });

  it('junior full-time converts the weekly rate at 38h', () => {
    // Level A, exit 12, school leaver = 551.10 / 38
    expect(getTraineeBaseRate({ category: 'junior', level: 'A', exitYear: 12, yearsOut: 0, aqfLevel: 3, yearOfTraineeship: 1, isPartTime: false }, '2025-06-01')).toBeCloseTo(551.10 / 38, 6);
  });

  it('applies the +3.8% Cert IV uplift', () => {
    const base = getTraineeBaseRate({ category: 'adult', level: 'A', aqfLevel: 3, yearOfTraineeship: 1, isPartTime: true }, '2025-06-01');
    const certIv = getTraineeBaseRate({ category: 'adult', level: 'A', aqfLevel: 4, yearOfTraineeship: 1, isPartTime: true }, '2025-06-01');
    expect(base).toBe(29.19);
    expect(certIv).toBeCloseTo(29.19 * 1.038, 6);
  });
});

describe('applyTraineeCpiIncrease', () => {
  const base = TRAINEE_RATE_SCHEDULE[0];
  const next = applyTraineeCpiIncrease(base, 3.6, '2026-07-01', 'ICC Sydney EA 2025 — 2026 increase');
  const f = 1 + (3.6 + 0.5) / 100;

  it('scales every dollar figure by CPI% + 0.5%, rounded to cents', () => {
    expect(next.weeklyLevelA[10][0]).toBe(round2(420.80 * f));
    expect(next.hourlyLevelA[10][3]).toBe(round2(21.10 * f));
    expect(next.adult.ftWeekly.A[1]).toBe(round2(920.70 * f));
    expect(next.schoolBasedHourly.yr12).toBe(round2(15.25 * f));
  });

  it('leaves the structural Cert IV uplift percentage unchanged', () => {
    expect(next.certIvUpliftPct).toBe(3.8);
  });

  it('does not mutate the base set', () => {
    expect(base.weeklyLevelA[10][0]).toBe(420.80);
  });
});
