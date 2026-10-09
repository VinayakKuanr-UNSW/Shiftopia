import { describe, it, expect } from 'vitest';
import {
  estimateDetailedCostFromShift,
  estimateCostFromShift,
  resolveShiftPayInputs,
} from '../../projections/utils/cost/index';
import type { ShiftPayTermsField } from '../../projections/utils/cost/types';
import { resolveRateSet } from '../../projections/utils/cost/rate-schedule';

/**
 * Cards priced on the linked contract (shifts.shift_pay_terms, migration
 * 20261008232922). Expected dollars are internal.shift_cost on prod for the
 * same shifts — the budget footer — so cards, budget and payroll agree.
 */

const terms = (o: Partial<ShiftPayTermsField>): ShiftPayTermsField => ({
  pay_basis: 'eba_level',
  employment_type: 'Casual',
  substantive_level: 4,
  paid_level: 4,
  higher_duties: false,
  base_rate: 37.82,
  ...o,
});

// Thursday 2026-10-08, 09:00–12:00.
const shift = (o: Record<string, unknown>) => ({
  shift_date: '2026-10-08',
  start_time: '09:00',
  end_time: '12:00',
  net_length_minutes: 180,
  scheduled_length_minutes: 180,
  unpaid_break_minutes: 0,
  target_employment_type: 'Casual',
  remuneration_level: 4,
  roles: { name: 'F&B Team Member' },
  ...o,
});

describe('card estimates on the linked contract’s terms', () => {
  it('an L7 casual on an L4 shift is priced at L7 (budget 134.76)', () => {
    const b = estimateDetailedCostFromShift(shift({
      shift_pay_terms: terms({ substantive_level: 7, paid_level: 7, base_rate: 44.92 }),
    }));
    expect(b.totalCost).toBe(134.76);
  });

  it('an L4 casual doing 3h of L6 work gets 4h at L6 (budget 172.48)', () => {
    const b = estimateDetailedCostFromShift(shift({
      remuneration_level: 6,
      shift_pay_terms: terms({ substantive_level: 4, paid_level: 6, higher_duties: true, base_rate: 43.12 }),
    }));
    expect(b.totalCost).toBe(172.48);
    expect(b.ordinaryHours).toBe(4);
  });

  it('a salaried shift is hours × the salary rate, flagged for pay views (budget 384.62)', () => {
    const b = estimateDetailedCostFromShift(shift({
      target_employment_type: 'FT',
      end_time: '17:00', net_length_minutes: 480, scheduled_length_minutes: 480,
      shift_pay_terms: terms({
        pay_basis: 'salary', employment_type: 'FT',
        substantive_level: null, paid_level: null, base_rate: 48.0769,
      }),
    }));
    expect(b.payBasis).toBe('salary');
    expect(b.totalCost).toBe(384.62);
    expect(b.overtimeCost).toBe(0);
  });

  it('annualised Security is Full-Time Security whatever the role is called (budget 436.68)', () => {
    const b = estimateDetailedCostFromShift(shift({
      target_employment_type: 'FT',
      start_time: '07:00', end_time: '19:00', net_length_minutes: 720, scheduled_length_minutes: 720,
      roles: { name: 'Venue Supervisor' },
      shift_pay_terms: terms({
        pay_basis: 'eba_security_annualised', employment_type: 'FT', base_rate: 36.39,
      }),
    }));
    expect(b.totalCost).toBe(436.68);
  });

  it('the legacy total-only wrapper agrees', () => {
    expect(estimateCostFromShift(shift({
      shift_pay_terms: terms({ substantive_level: 7, paid_level: 7, base_rate: 44.92 }),
    }))).toBe(134.76);
  });
});

describe('without contract terms: the shift’s own level, never a guess or an override', () => {
  it('prices the stored level, not the role name', () => {
    // 'F&B Team Member' matches no keyword — the old path fell to Level 1.
    const b = estimateDetailedCostFromShift(shift({ remuneration_level: 4 }));
    expect(b.totalCost).toBe(Math.round(3 * resolveRateSet('2026-10-08').wageRates.LEVEL_4.casual * 100) / 100);
  });

  it('Level 0 is the Introductory (TRAINEE) rate', () => {
    expect(resolveShiftPayInputs({ remunerationLevel: 0, roleName: 'Supervisor' }).classificationLevel).toBe('TRAINEE');
    expect(resolveShiftPayInputs({ remunerationLevel: null, roleName: 'Supervisor' }).classificationLevel).toBe('LEVEL_5');
  });

  it('ignores per-shift rate overrides', () => {
    const plain = estimateDetailedCostFromShift(shift({}));
    const overridden = estimateDetailedCostFromShift(shift({ remuneration_rate: 99, actual_hourly_rate: 99 }));
    expect(overridden.totalCost).toBe(plain.totalCost);
  });
});
