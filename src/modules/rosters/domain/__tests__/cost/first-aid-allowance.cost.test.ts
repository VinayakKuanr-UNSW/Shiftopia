import { describe, it, expect } from 'vitest';
import { estimateDetailedShiftCost as securityCost } from '../../projections/utils/cost/security';
import { estimateDetailedCostFromShift } from '../../projections/utils/cost/index';
import { resolveShiftAllowances } from '../../projections/utils/cost/shift-allowances';
import type { CostCalculatorOptions } from '../../projections/utils/cost/types';

/**
 * cl 28.2 — "A Team Member holding a first aid qualification ... and who is
 * appointed by the Employer to perform First Aid duties must be paid for
 * ordinary hours a First Aid Allowance as set out in Schedule 2."
 * Sch 2 §3: $0.56 per hour; +5.1% to $0.59 from the first pay period on or
 * after 6 Jul 2026 (rate-schedule.ts).
 *
 * The appointment lives in `first_aid_appointments` and reaches a shift row as
 * the computed field `is_first_aid_duty`. Every test here compares the same
 * shift with and without the allowance, so the delta isolates cl 28.2 from
 * every other term of the engine.
 *
 * Dates: 2026-06-29 and 2026-07-06 are Mondays, neither a NSW public holiday.
 */

const securityBase = (o: Partial<CostCalculatorOptions>): CostCalculatorOptions => ({
  netMinutes: 0,
  start_time: '09:00',
  end_time: '17:00',
  rate: 40,
  scheduled_length_minutes: 480,
  is_overnight: false,
  is_cancelled: false,
  shift_date: '2026-06-29',
  employmentType: 'Casual',
  ...o,
});

const firstAidDelta = (o: Partial<CostCalculatorOptions>) =>
  securityCost(securityBase({ ...o, allowances: { firstAid: true } })).totalCost
  - securityCost(securityBase(o)).totalCost;

describe('resolveShiftAllowances — the computed field reaches the engine', () => {
  it('leaves a shift with no appointment untouched', () => {
    expect(resolveShiftAllowances({})).toBeUndefined();
    expect(resolveShiftAllowances({ is_first_aid_duty: false })).toBeUndefined();
    expect(resolveShiftAllowances({ is_first_aid_duty: null, allowances: { meal: false } }))
      .toEqual({ meal: false });
  });

  it('sets firstAid when the assignee is appointed, keeping any other flag', () => {
    expect(resolveShiftAllowances({ is_first_aid_duty: true })).toEqual({ firstAid: true });
    expect(resolveShiftAllowances({ is_first_aid_duty: true, allowances: { splitShift: true } }))
      .toEqual({ splitShift: true, firstAid: true });
  });
});

describe('Security engine — cl 28.2 applies to Part-Time and Casual Event Security', () => {
  it('casual event security: $0.56 on each of 8 ordinary hours', () => {
    expect(firstAidDelta({})).toBeCloseTo(8 * 0.56, 2);
  });

  it('part-time event security is paid it too', () => {
    expect(firstAidDelta({ employmentType: 'Part-Time' })).toBeCloseTo(8 * 0.56, 2);
  });

  it('is paid "for ordinary hours" only — overtime hours past the 12h cap earn none', () => {
    // 06:00–20:00 = 14h on the clock (security meal breaks are paid): 12 ordinary + 2 OT.
    const r = securityCost(securityBase({ start_time: '06:00', end_time: '20:00', scheduled_length_minutes: 840 }));
    expect(r.overtimeHours).toBe(2);
    expect(firstAidDelta({ start_time: '06:00', end_time: '20:00', scheduled_length_minutes: 840 }))
      .toBeCloseTo(r.ordinaryHours * 0.56, 2);
  });

  it('uses the effective-dated FY26/27 rate after 6 Jul 2026', () => {
    expect(firstAidDelta({ shift_date: '2026-07-06' })).toBeCloseTo(8 * 0.59, 2);
  });

  it('annualised full-time security gets nothing extra — Sch 3 §4.1(b) salary is in lieu of allowances', () => {
    expect(firstAidDelta({ rate: 32.20, employmentType: 'Full-Time' })).toBe(0);
  });
});

describe('legacy cost wrappers read the computed field off a raw shift row', () => {
  const row = (isFirstAid: boolean) => ({
    id: `s-${isFirstAid}`,
    shift_date: '2026-06-29',
    start_time: '09:00',
    end_time: '17:00',
    unpaid_break_minutes: 30,
    net_length_minutes: 450,
    scheduled_length_minutes: 480,
    remuneration_rate: 30,
    target_employment_type: 'PT',
    is_overnight: false,
    is_cancelled: false,
    is_first_aid_duty: isFirstAid,
  });

  it('prices the allowance on the ordinary hours a standard-engine shift pays', () => {
    const withAid = estimateDetailedCostFromShift(row(true));
    const without = estimateDetailedCostFromShift(row(false));
    expect(withAid.totalCost - without.totalCost).toBeGreaterThan(0);
    expect(withAid.totalCost - without.totalCost).toBeCloseTo(without.ordinaryHours * 0.56, 2);
  });
});
