import { describe, it, expect } from 'vitest';
import {
  RATE_SCHEDULE,
  resolveRateSet,
  applyCpiIncrease,
  isRateScheduleStale,
  type RateSet,
} from '../../projections/utils/cost/rate-schedule';
import {
  WAGE_RATES,
  DEFAULT_RATE,
  ALLOWANCE_MEAL,
  ALLOWANCE_SPLIT_SHIFT,
} from '../../projections/utils/cost/constants';

const r2 = (x: number) => Math.round(x * 100) / 100;

describe('rate-schedule — 2025 baseline mirrors constants.ts (behaviour-preserving)', () => {
  it('the 2025 set exposes the exact constants values', () => {
    // A date before the FY2026/27 increase (6 Jul 2026) resolves to the baseline.
    const rs = resolveRateSet('2025-07-01');
    expect(rs.effectiveFrom).toBe('2025-01-01');
    expect(rs.wageRates.LEVEL_1.casual).toBe(WAGE_RATES.LEVEL_1.casual);
    expect(rs.wageRates.LEVEL_7.permanent).toBe(WAGE_RATES.LEVEL_7.permanent);
    expect(rs.defaultRate).toBe(DEFAULT_RATE);
    expect(rs.allowances.meal).toBe(ALLOWANCE_MEAL);
    expect(rs.allowances.splitShift).toBe(ALLOWANCE_SPLIT_SHIFT);
    expect(rs.security.annualisedHourly.level3).toBe(32.20);
    expect(rs.security.ordinaryFromAnnualised[32.20]).toBe(27.23);
  });
});

describe('rate-schedule — FY2026/27 (+5.1%, from 6 Jul 2026)', () => {
  it('exposes the published FY26/27 Schedule 2 values (not a naive ×1.051)', () => {
    const rs = resolveRateSet('2026-07-06');
    expect(rs.effectiveFrom).toBe('2026-07-06');
    expect(rs.wageRates.LEVEL_1.permanent).toBe(26.96);
    expect(rs.wageRates.LEVEL_1.casual).toBe(33.70);
    expect(rs.wageRates.LEVEL_7.casual).toBe(44.92);
    expect(rs.wageRates.LEVEL_3.casual).toBe(35.77);   // ×1.051 would be 35.78
    expect(rs.defaultRate).toBe(33.70);
    expect(rs.allowances.meal).toBe(14.30);
    expect(rs.allowances.proteinSpill).toBe(7.53);      // ×1.051 would be 7.54
    expect(rs.security.annualisedHourly.level4).toBe(36.39); // ×1.051 would be 36.40
    expect(rs.security.ordinaryFromAnnualised[36.39]).toBe(30.26);
  });
});

describe('resolveRateSet — effective-dated resolution', () => {
  it('the day BEFORE the FY26 increase still resolves to the 2025 baseline', () => {
    expect(resolveRateSet('2026-07-05').effectiveFrom).toBe('2025-01-01');
  });

  it('on/after 6 Jul 2026 resolves to the FY2026/27 set (inclusive lower bound)', () => {
    expect(resolveRateSet('2026-07-06').effectiveFrom).toBe('2026-07-06');
    expect(resolveRateSet('2030-01-01').effectiveFrom).toBe('2026-07-06');
  });

  it('a date before the earliest entry falls back to the earliest set', () => {
    expect(resolveRateSet('2000-01-01').effectiveFrom).toBe(RATE_SCHEDULE[0].effectiveFrom);
  });

  it('a missing / invalid date falls back to the earliest set', () => {
    expect(resolveRateSet(undefined).effectiveFrom).toBe(RATE_SCHEDULE[0].effectiveFrom);
    expect(resolveRateSet('').effectiveFrom).toBe(RATE_SCHEDULE[0].effectiveFrom);
  });

  it('strips a time component before comparing', () => {
    expect(resolveRateSet('2026-07-06T09:00:00').effectiveFrom).toBe('2026-07-06');
  });

  it('selects the latest applicable entry from a multi-year schedule (inclusive boundary)', () => {
    const base = RATE_SCHEDULE[0];
    const y2026 = applyCpiIncrease(base, 3.5, '2026-07-01', 'FY2026');
    const fixture: RateSet[] = [{ ...base, label: 'FY2025' }, y2026];
    expect(resolveRateSet('2026-06-30', fixture).label).toBe('FY2025');
    expect(resolveRateSet('2026-07-01', fixture).label).toBe('FY2026'); // inclusive lower bound
    expect(resolveRateSet('2027-01-01', fixture).label).toBe('FY2026');
  });
});

describe('applyCpiIncrease — cl 25.1 (CPI + 0.5%), pure', () => {
  const base = RATE_SCHEDULE[0];
  const next = applyCpiIncrease(base, 3.5, '2026-07-01', 'FY2026');
  const factor = 1 + (3.5 + 0.5) / 100; // 1.04

  it('raises every wage & allowance by CPI + 0.5%, rounded to cents', () => {
    expect(next.wageRates.LEVEL_1.casual).toBe(r2(base.wageRates.LEVEL_1.casual * factor));
    expect(next.wageRates.LEVEL_4.permanent).toBe(r2(base.wageRates.LEVEL_4.permanent * factor));
    expect(next.allowances.meal).toBe(r2(base.allowances.meal * factor));
    expect(next.defaultRate).toBe(r2(base.defaultRate * factor));
  });

  it('rebuilds the security annualised → ordinary mapping under the new keys', () => {
    const newAnnual = r2(base.security.annualisedHourly.level3 * factor);
    const newOrdinary = r2(base.security.ordinaryFromAnnualised[32.20] * factor);
    expect(next.security.annualisedHourly.level3).toBe(newAnnual);
    expect(next.security.ordinaryFromAnnualised[newAnnual]).toBe(newOrdinary);
  });

  it('sets metadata and does NOT mutate the base set', () => {
    expect(next.effectiveFrom).toBe('2026-07-01');
    expect(next.label).toBe('FY2026');
    expect(base.wageRates.LEVEL_1.casual).toBe(WAGE_RATES.LEVEL_1.casual);
    expect(base.allowances.meal).toBe(ALLOWANCE_MEAL);
  });
});

describe('isRateScheduleStale — audit L-3 freshness alert', () => {
  const schedule: RateSet[] = [
    { ...RATE_SCHEDULE[0], effectiveFrom: '2026-01-01' },
    { ...RATE_SCHEDULE[0], effectiveFrom: '2026-07-06' },
  ];

  it('is not stale shortly after the latest entry', () => {
    expect(isRateScheduleStale(schedule, new Date('2026-08-01'))).toBe(false);
  });

  it('is not stale exactly at the 1-year mark yet', () => {
    expect(isRateScheduleStale(schedule, new Date('2027-07-01'))).toBe(false);
  });

  it('is stale once well past a year with no successor entry', () => {
    expect(isRateScheduleStale(schedule, new Date('2027-08-01'))).toBe(true);
  });

  it('picks the LATEST entry regardless of array order', () => {
    const reversed = [...schedule].reverse();
    expect(isRateScheduleStale(reversed, new Date('2027-08-01'))).toBe(true);
    expect(isRateScheduleStale(reversed, new Date('2026-08-01'))).toBe(false);
  });
});
