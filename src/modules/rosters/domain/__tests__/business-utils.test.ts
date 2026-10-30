import { describe, expect, it } from 'vitest';

import { minutesToTime, timeToMinutes } from '../shiftSynthesizer.policy';
import {
  calculateFatigueAccumulation,
  calculateFatigueWithRecovery,
} from '../projections/utils/fatigue';
import {
  calculateUtilization,
} from '../projections/utils/fairness';

describe('time helpers', () => {
  it('converts between display times and timeline minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('17:00:00')).toBe(1020);
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1440)).toBe('24:00');
  });
});

describe('fatigue and fairness calculations', () => {

  it('weights overnight work more heavily than daytime work', () => {
    const daytime = calculateFatigueAccumulation({
      start_time: '10:00',
      end_time: '16:00',
    });
    const overnight = calculateFatigueAccumulation({
      start_time: '00:00',
      end_time: '06:00',
    });

    expect(daytime).toBeGreaterThan(0);
    expect(overnight).toBeGreaterThan(daytime);
    expect(calculateFatigueAccumulation({
      start_time: '00:00',
      end_time: '00:00',
    })).toBeGreaterThan(overnight);
  });

  it('filters the seven-day window, applies recovery and projects a candidate', () => {
    const result = calculateFatigueWithRecovery([
      {
        shift_date: '2026-07-20',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
      {
        shift_date: '2026-08-01',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
      {
        shift_date: '2026-08-02',
        start_time: '09:00',
        end_time: '17:00',
        unpaid_break_minutes: 30,
      },
    ], '2026-08-03', {
      start_time: '22:00',
      end_time: '06:00',
      unpaid_break_minutes: 0,
    });

    // The 2026-07-20 shift is outside the 7-day window and must not contribute.
    const withoutStaleShift = calculateFatigueWithRecovery([
      { shift_date: '2026-08-01', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 },
      { shift_date: '2026-08-02', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 30 },
    ], '2026-08-03', {
      start_time: '22:00',
      end_time: '06:00',
      unpaid_break_minutes: 0,
    });
    expect(result).toEqual(withoutStaleShift);

    // `peak` is the reading at the end of the last shift, before any rest.
    expect(result.peak).toBeGreaterThan(0);

    // `current` is measured at the reference instant, so it decays with rest.
    // The last shift ends 2026-08-02 17:00 and the window closes at the end of
    // 2026-08-03 — 31 hours later — which at RECOVERY_UNITS_PER_HOUR (a full
    // OK-band recovery per 11h minimum break) is well past full recovery.
    //
    // The mobile branch asserted `current > 0` here. That encodes the bug fixed
    // in audit F-03: recovery used to be applied only *between* shifts and never
    // from the last shift to the reference instant, which made `current` a
    // duplicate of `peak` and turned decay into a step function. Asserting it
    // again would re-pin the defect.
    expect(result.current).toBeLessThan(result.peak);
    expect(result.current).toBe(0);

    // The candidate is projected from the pre-decay state, so it still adds load.
    expect(result.projected).toBeGreaterThan(result.current);
  });

  it('calculates utilization, inequality and status boundaries', () => {
    expect(calculateUtilization(20, 40)).toBe(50);
    expect(calculateUtilization(20, 0)).toBe(0);
  });
});
