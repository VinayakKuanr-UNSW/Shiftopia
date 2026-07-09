import { describe, it, expect } from 'vitest';
import {
  getFatigueBand,
  FATIGUE_BANDS,
  calculateFatigueWithRecovery,
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
  it('a single day shift returns a positive current fatigue', () => {
    const { current } = calculateFatigueWithRecovery(
      [{ shift_date: '2025-03-15', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 0 }],
      '2025-03-15',
    );
    expect(current).toBeGreaterThan(0);
    expect(current).toBeCloseTo(14.3, 1);
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
