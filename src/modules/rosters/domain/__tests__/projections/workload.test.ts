import { describe, it, expect } from 'vitest';
import {
  periodContractedHours,
  computeUtilizationPct,
  isOverContractedHours,
  computePeakFatigue,
} from '../../projections/utils/workload';

// ── periodContractedHours — weekly floor (M6) ──────────────────────────────────

describe('periodContractedHours — weekly floor (M6)', () => {
  it('Day view (rangeDays=1) is floored to a full week: 38 → 38', () => {
    expect(periodContractedHours(38, 1)).toBe(38);
  });

  it('Week view (rangeDays=7) is exactly the weekly contract', () => {
    expect(periodContractedHours(38, 7)).toBe(38);
  });

  it('Two weeks (rangeDays=14) scales linearly: 38 → 76', () => {
    expect(periodContractedHours(38, 14)).toBe(76);
  });

  it('Month view (28–31 days) matches 38 * days/7', () => {
    expect(periodContractedHours(38, 28)).toBeCloseTo((38 * 28) / 7, 6); // 152
    expect(periodContractedHours(38, 30)).toBeCloseTo((38 * 30) / 7, 6);
    expect(periodContractedHours(38, 31)).toBeCloseTo((38 * 31) / 7, 6); // ~168.29
  });

  it('missing rangeDays falls back to a 7-day window (never divides by zero)', () => {
    expect(periodContractedHours(38, undefined)).toBe(38);
  });

  it('zero / undefined / negative contract → 0', () => {
    expect(periodContractedHours(0, 7)).toBe(0);
    expect(periodContractedHours(undefined, 7)).toBe(0);
    expect(periodContractedHours(null, 7)).toBe(0);
    expect(periodContractedHours(-5, 7)).toBe(0);
  });
});

// ── computeUtilizationPct ──────────────────────────────────────────────────────

describe('computeUtilizationPct', () => {
  it('Day view no longer over-reads: 8h against a 38h contract ≈ 21% (NOT ~147%)', () => {
    const utl = computeUtilizationPct(8, 38, 1);
    expect(utl).toBeCloseTo((8 / 38) * 100, 6); // ~21.05%
    expect(utl).toBeGreaterThan(20);
    expect(utl).toBeLessThan(22);
    // Guard against the pre-fix 60/day-scaled over-read.
    expect(utl).toBeLessThan(100);
  });

  it('a full week at contract → ~100%', () => {
    expect(computeUtilizationPct(38, 38, 7)).toBeCloseTo(100, 6);
  });

  it('zero contract → 0 (divide-by-zero guarded, e.g. Open Shifts bucket)', () => {
    expect(computeUtilizationPct(8, 0, 7)).toBe(0);
    expect(computeUtilizationPct(8, undefined, 7)).toBe(0);
    expect(computeUtilizationPct(8, null, 7)).toBe(0);
  });
});

// ── isOverContractedHours ──────────────────────────────────────────────────────

describe('isOverContractedHours', () => {
  it('true when scheduled exceeds the period contract', () => {
    expect(isOverContractedHours(40, 38, 7)).toBe(true);
  });

  it('false when scheduled is at or under the period contract', () => {
    expect(isOverContractedHours(38, 38, 7)).toBe(false);
    expect(isOverContractedHours(30, 38, 7)).toBe(false);
  });

  it('false when there is no contract to exceed', () => {
    expect(isOverContractedHours(8, 0, 7)).toBe(false);
  });

  it('Day view uses the weekly floor, so a single 8h shift is NOT over', () => {
    // Without the floor this would be 8 > 38/7 ≈ 5.43 → true (the M6 bug).
    expect(isOverContractedHours(8, 38, 1)).toBe(false);
  });
});

// ── computePeakFatigue ─────────────────────────────────────────────────────────

describe('computePeakFatigue', () => {
  it('empty roster → 0', () => {
    expect(computePeakFatigue([])).toBe(0);
  });

  it('a single 09:00–17:00 day shift yields the formula value (~14.3), not 0', () => {
    const peak = computePeakFatigue([
      { shift_date: '2025-03-15', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 },
    ]);
    // Derived from the fatigue model: -76*ln(1 - 6.50/38) ≈ 14.3.
    expect(peak).toBeCloseTo(14.3, 1);
    expect(peak).toBeGreaterThan(0);
  });

  it('does NOT read 0 for a future-dated roster (the historical "as of today" bug)', () => {
    // Anchored 5 years in the future — the old "today" anchor read 0 here.
    const peak = computePeakFatigue([
      { shift_date: '2030-12-25', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 },
    ]);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeCloseTo(14.3, 1);
  });

  // ── 7-day history lookback (view-independent FTG) ──────────────────────────
  it('empty history is identical to no history', () => {
    const visible = [{ shift_date: '2026-07-08', start_time: '07:00', end_time: '15:00', unpaid_break_minutes: 0 }];
    expect(computePeakFatigue(visible, [])).toBe(computePeakFatigue(visible));
  });

  it('recent prior-day history INCREASES the peak (Day view no longer under-counts)', () => {
    // Same visible day as the earlier WEEK/MONTH view would show, but Day view
    // used to only see this one shift. A tightly-spaced prior night shift (ends
    // 06:00, next starts 07:00 → 1h rest) should push the peak well above the
    // no-history value.
    const visible = [{ shift_date: '2026-07-08', start_time: '07:00', end_time: '15:00', unpaid_break_minutes: 0 }];
    const history = [{ shift_date: '2026-07-07', start_time: '22:00', end_time: '06:00', unpaid_break_minutes: 0 }];
    const withHistory = computePeakFatigue(visible, history);
    const withoutHistory = computePeakFatigue(visible);
    expect(withHistory).toBeGreaterThan(withoutHistory);
  });

  it('history older than the 7-day window is ignored', () => {
    const visible = [{ shift_date: '2026-07-08', start_time: '07:00', end_time: '15:00', unpaid_break_minutes: 0 }];
    // ~5 weeks before the visible day → outside every reference date's 7-day window.
    const staleHistory = [{ shift_date: '2026-06-01', start_time: '22:00', end_time: '06:00', unpaid_break_minutes: 0 }];
    expect(computePeakFatigue(visible, staleHistory)).toBe(computePeakFatigue(visible));
  });
});
