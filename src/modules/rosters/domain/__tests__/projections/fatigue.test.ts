import { describe, it, expect } from 'vitest';
import {
  getFatigueBand,
  FATIGUE_BANDS,
  calculateFatigueWithRecovery,
  RECOVERY_UNITS_PER_HOUR,
  MINIMUM_REST_BREAK_HOURS,
} from '../../projections/utils/fatigue';

// ── getFatigueBand — recalibrated thresholds (M1) ──────────────────────────────

describe('getFatigueBand', () => {
  it('scores below OK_MAX (20) are "ok"', () => {
    expect(getFatigueBand(0)).toBe('ok');
    expect(getFatigueBand(14)).toBe('ok'); // a normal 8h day shift (~14.3)
    expect(getFatigueBand(19.9)).toBe('ok');
  });

  it('OK_MAX (20) through just below RISK_MAX (35) are "risk"', () => {
    expect(getFatigueBand(20)).toBe('risk');
    expect(getFatigueBand(26)).toBe('risk'); // a single 8h night shift (~26)
    expect(getFatigueBand(34.9)).toBe('risk');
  });

  it('RISK_MAX (35) and above are "critical"', () => {
    expect(getFatigueBand(35)).toBe('critical');
    expect(getFatigueBand(100)).toBe('critical');
  });

  it('exposes the calibrated band edges', () => {
    expect(FATIGUE_BANDS.OK_MAX).toBe(20);
    expect(FATIGUE_BANDS.RISK_MAX).toBe(35);
  });
});

// ── calculateFatigueWithRecovery ───────────────────────────────────────────────

describe('calculateFatigueWithRecovery', () => {
  it('a single day shift peaks at the formula value and then decays', () => {
    const { current, peak } = calculateFatigueWithRecovery(
      [{ shift_date: '2025-03-15', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 }],
      '2025-03-15',
    );
    // `peak` is the value at clock-off: -76*ln(1 - 6.50/38) ~= 14.3.
    expect(peak).toBeCloseTo(14.3, 1);
    // `current` is the value AT the reference instant (end of 2025-03-15), so
    // the 7h of rest from 17:00 to midnight has been recovered at
    // RECOVERY_UNITS_PER_HOUR (audit F-03). Before that fix these two numbers
    // were the same, which is what made a shift from six days ago read as
    // freshly-worked.
    //
    // Derived from the constant rather than hardcoded: the rate is a modelling
    // parameter (decision Q8) and recalibrating it must not read as a
    // regression here.
    // Precision 0 (±0.5): both `current` and `peak` are rounded to 1dp inside
    // the model, so a tighter tolerance would be asserting the rounding, not
    // the recovery.
    expect(current).toBeCloseTo(peak - 7 * RECOVERY_UNITS_PER_HOUR, 0);
    expect(current).toBeGreaterThan(0);
  });

  it('a full minimum rest break clears the OK band (decision Q8 anchor)', () => {
    // The recovery rate is DERIVED from the agreement's 11-hour rest break:
    // a compliant break should return an employee from the top of the OK band
    // to baseline. This is the derivation, made executable — if someone
    // rewrites the rate to an arbitrary literal, this fails.
    expect(RECOVERY_UNITS_PER_HOUR * MINIMUM_REST_BREAK_HOURS)
      .toBeCloseTo(FATIGUE_BANDS.OK_MAX, 6);
  });

  it('fatigue decays to zero once enough rest has elapsed (audit F-03)', () => {
    // Ends at 23:00 on the reference date, so `justFinished` really has only
    // ~1h of rest. The earlier version of this test used a 00:00–08:00 shift
    // read at end of day — 16 hours of rest — and only passed because recovery
    // was slow enough for that not to matter. It was asserting a decay property
    // using a case that had substantially decayed.
    const shift = (d: string) =>
      [{ shift_date: d, start_time: '15:00', end_time: '23:00', unpaid_break_minutes: 0 }];

    const justFinished = calculateFatigueWithRecovery(shift('2026-08-10'), '2026-08-10');
    const sixDaysAgo = calculateFatigueWithRecovery(shift('2026-08-04'), '2026-08-10');

    // Same peak — the work was identical.
    expect(justFinished.peak).toBeCloseTo(sixDaysAgo.peak, 1);
    // Different `current` — one of them has rested for six days. Both reported
    // the peak before the fix, so a fully-rested employee was penalised as if
    // they had only just clocked off.
    expect(justFinished.current).toBeGreaterThan(0);
    expect(sixDaysAgo.current).toBe(0);
    expect(justFinished.current).toBeGreaterThan(sixDaysAgo.current);
  });

  it('two shifts far apart recover toward the later shift only', () => {
    // Two identical 09:00–17:00 day shifts, 5 days apart. The ~120h of rest
    // between them (>> the ~14.3 fatigue of the first) fully recovers the
    // earlier shift, so the window anchored on the later date reads just the
    // later shift's own contribution — not the sum.
    const soloLater = calculateFatigueWithRecovery(
      [{ shift_date: '2025-03-15', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 }],
      '2025-03-15',
    ).current;

    const both = calculateFatigueWithRecovery(
      [
        { shift_date: '2025-03-10', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 },
        { shift_date: '2025-03-15', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 },
      ],
      '2025-03-15',
    ).current;

    expect(both).toBeCloseTo(soloLater, 1);
    // It did NOT simply stack both shifts.
    expect(both).toBeLessThan(soloLater * 2 - 1);
  });
});
