import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost } from '../../projections/utils/cost/standard';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * Regression tests for the Standard cost engine — pins the EBA-correct behaviour
 * fixed in Phase 1 of the compliance audit:
 *   H1  FT/PT overtime must not double-count (ordinary + OT === net worked)
 *   C3  weekend/PH penalty and night allowance are NOT cumulative (cl. 41.4)
 *   M5  school-based apprentices get no +25% loading (Schedule 4 has none)
 * Plus penalty-rate sanity locks (cl. 41 / 56).
 *
 * Dates chosen relative to the project clock: 2026-07-04 = Saturday,
 * 2026-07-05 = Sunday, 2026-07-06 = Monday (none are NSW public holidays).
 */

const base = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 0,
  start_time: '09:00',
  end_time: '17:00',
  rate: 30,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-07-06', // Monday
  employmentType: 'Full-Time',
  ...o,
});

describe('H1 — FT/PT overtime never double-counts', () => {
  it('a 10h worked / 8h rostered weekday shift bills exactly 10h, not 12h', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 600, scheduled_length_minutes: 480, start_time: '09:00', end_time: '19:00' }),
    );
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(2);
    // The invariant that was broken: ordinary + overtime === net worked.
    expect(r.ordinaryHours + r.overtimeHours).toBe(10);
    // 8h ordinary @30 + 2h OT @1.5x30 = 240 + 90.
    expect(r.totalCost).toBeCloseTo(330, 5);
  });

  it('the normal projection path (net <= scheduled) is unchanged', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, start_time: '09:00', end_time: '17:00' }),
    );
    expect(r.ordinaryHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
    expect(r.totalCost).toBeCloseTo(240, 5);
  });
});

describe('C3 — weekend/PH penalty and night allowance are not cumulative', () => {
  it('a Saturday night shift pays the Saturday penalty but NO night allowance', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        start_time: '22:00',
        end_time: '06:00',
        is_overnight: true,
        shift_date: '2026-07-04', // Saturday
        employmentType: 'Casual',
        rate: 37.5, // casual base
      }),
    );
    expect(r.breakdown.nightAllowanceCost).toBe(0);
    expect(r.allowanceCost).toBe(0);
  });

  it('a plain weekday night shift STILL gets the night allowance (no over-suppression)', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 480,
        scheduled_length_minutes: 480,
        start_time: '22:00',
        end_time: '06:00',
        is_overnight: true,
        shift_date: '2026-07-06', // Monday -> concludes Tuesday, no weekend penalty
      }),
    );
    expect(r.breakdown.nightAllowanceCost).toBeGreaterThan(0);
  });
});

describe('penalty-rate locks (cl. 41 / 56)', () => {
  it('Sunday permanent ordinary is 150%', () => {
    const r = estimateDetailedShiftCost(
      base({ netMinutes: 480, scheduled_length_minutes: 480, shift_date: '2026-07-05' }),
    );
    // 8h @ (30 * 1.5) = 360
    expect(r.ordinaryCost).toBeCloseTo(360, 5);
  });
});

describe('M5 — school-based apprentices get no +25% loading', () => {
  it('applies only the Schedule 4 percentage, not an extra 1.25x', () => {
    const r = estimateDetailedShiftCost(
      base({
        netMinutes: 60,
        scheduled_length_minutes: 60,
        start_time: '09:00',
        end_time: '10:00',
        rate: 100,
        is_apprentice: true,
        apprentice_type: 'school_based',
        apprentice_year: 1,
      } as Partial<CostCalculatorOptions>),
    );
    // Year-1 school-based apprentice = 50% of base. Must be 50, not 62.5.
    expect(r.breakdown.baseRate).toBeCloseTo(50, 5);
  });
});
