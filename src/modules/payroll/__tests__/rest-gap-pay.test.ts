import { describe, it, expect } from 'vitest';
import {
  computeEmployeePeriodGrossPay,
  type PeriodBounds,
} from '../domain/aggregatePeriodGrossPay';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { EarningsCode } from '../model/gross-pay.types';

const bounds: PeriodBounds = {
  periodStart: '2026-07-06',
  periodEnd: '2026-07-12',
};

const shift = (o: Partial<GrossPayShiftInput>): GrossPayShiftInput => ({
  shiftId: 's1',
  employeeId: 'e1',
  shiftDate: '2026-07-06',
  netMinutes: 480, // 8h
  startTime: '09:00',
  endTime: '17:00',
  scheduledLengthMinutes: 480,
  isOvernight: false,
  rate: 30,
  employmentType: 'Full-Time',
  classificationLevel: 'LEVEL_3',
  ...o,
});

const line = (lines: { code: EarningsCode; amount: number }[], code: EarningsCode) =>
  lines.find((l) => l.code === code);

describe('computeEmployeePeriodGrossPay — cl 40.1 rest-gap penalty', () => {
  it('applies no penalty when gap is >= 10h (600m)', () => {
    // 17:00 to 09:00 next day = 16h gap
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '09:00', endTime: '17:00' }),
      shift({ shiftId: 's2', shiftDate: '2026-07-07', startTime: '09:00', endTime: '17:00' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(line(period.lines, 'rest_gap_penalty')).toBeUndefined();
  });

  it('applies double-time floor penalty when gap is < 10h', () => {
    // Shift 1: 15:00 to 23:00
    // Shift 2: 07:00 to 15:00 next day
    // Gap = 8h (480m) < 10h
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00' }),
      shift({ shiftId: 's2', shiftDate: '2026-07-07', startTime: '07:00', endTime: '15:00' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    
    const penaltyLine = line(period.lines, 'rest_gap_penalty');
    expect(penaltyLine).toBeDefined();
    
    // Shift 2 starts 07:00, ends 15:00. Ordinary pay = 8h * 30 = 240.
    // Shift 2 double-time floor = 8h * (30 * 2) = 480.
    // Shortfall = 480 - 240 = 240.
    expect(penaltyLine!.amount).toBeCloseTo(240, 2);
  });

  it('applies to CASUALS too — cl 40.1 covers every Team Member (2× de-loaded floor)', () => {
    const inputs = [
      shift({ shiftId: 'c1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00', employmentType: 'Casual', rate: 37.5 }),
      shift({ shiftId: 'c2', shiftDate: '2026-07-07', startTime: '07:00', endTime: '15:00', employmentType: 'Casual', rate: 37.5 }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    // Casual weekday effective = 37.5/h (loaded); floor = 2 × 30 (de-loaded,
    // loading absorbed like cl 42.2 OT) = 60 ⇒ uplift (60 − 37.5) × 8 = 180.
    expect(line(period.lines, 'rest_gap_penalty')!.amount).toBeCloseTo(180, 2);
  });

  it('fires on the LIVE path where the input rate is null (classification-resolved)', () => {
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00', rate: null }),
      shift({ shiftId: 's2', shiftDate: '2026-07-07', startTime: '07:00', endTime: '15:00', rate: null }),
    ];
    // classificationLevel LEVEL_3 permanent = 28.62 (FY26/27 rates, in force from
    // 6 Jul 2026 — these shifts are dated 6/7 Jul 2026) — the sweep must price the
    // floor from the PRICED ordinary rate, not the (null) input rate.
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(line(period.lines, 'rest_gap_penalty')!.amount).toBeCloseTo((2 * 28.62 - 28.62) * 8, 2);
  });

  it('no additional uplift if the shift is already earning >= double time (PH 2.5×)', () => {
    const phBounds: PeriodBounds = { periodStart: '2026-01-19', periodEnd: '2026-02-01' };
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-01-25', startTime: '15:00', endTime: '23:00' }), // Sunday
      shift({ shiftId: 's2', shiftDate: '2026-01-26', startTime: '07:00', endTime: '15:00' }), // Australia Day (PH)
    ];
    // PH ordinary = 2.5 × 30 = 75/h ≥ the 60/h double-time floor ⇒ no uplift.
    const period = computeEmployeePeriodGrossPay('e1', inputs, phBounds);
    expect(line(period.lines, 'rest_gap_penalty')).toBeUndefined();
  });

  it('respects relaxed configuration (e.g. 8h for multi-hire)', () => {
    // Gap = 8h (480m)
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00' }),
      shift({ shiftId: 's2', shiftDate: '2026-07-07', startTime: '07:00', endTime: '15:00' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds, { minRestGapMinutes: 480 });
    expect(line(period.lines, 'rest_gap_penalty')).toBeUndefined();
  });

  it('ignores leave shifts when calculating rest gap', () => {
    // Work shift ending 23:00
    // Next day is leave (effectively starts 00:00 or whenever, but is Leave)
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00' }),
      shift({ shiftId: 'l1', shiftDate: '2026-07-07', startTime: '09:00', endTime: '17:00', isAnnualLeave: true }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(line(period.lines, 'rest_gap_penalty')).toBeUndefined();
  });

  it('a timeless leave day between two worked shifts neither triggers nor anchors the gap', () => {
    // Mon worked 15:00–23:00; Tue is a synthesised annual-leave day with NO
    // clock times; Wed worked 07:00–15:00. The gap must be measured from the
    // last WORKED shift (Mon 23:00 → Wed 07:00 = 32h), never from a fabricated
    // leave "interval" — so no penalty.
    const inputs = [
      shift({ shiftId: 's1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00' }),
      shift({ shiftId: 'l1', shiftDate: '2026-07-07', startTime: undefined, endTime: undefined, isAnnualLeave: true }),
      shift({ shiftId: 's2', shiftDate: '2026-07-08', startTime: '07:00', endTime: '15:00' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(line(period.lines, 'rest_gap_penalty')).toBeUndefined();
  });

  it('multi-shift chain: penalty continues if gap remains insufficient', () => {
    const crossDayInputs = [
      shift({ shiftId: 'x1', shiftDate: '2026-07-06', startTime: '15:00', endTime: '23:00' }),
      shift({ shiftId: 'x2', shiftDate: '2026-07-07', startTime: '07:00', endTime: '15:00' }), // Gap 8h -> penalty
      shift({ shiftId: 'x3', shiftDate: '2026-07-08', startTime: '00:00', endTime: '08:00' }), // Gap 9h (15:00 to 00:00) -> penalty
    ];

    const period = computeEmployeePeriodGrossPay('e1', crossDayInputs, bounds);
    const penaltyLine = line(period.lines, 'rest_gap_penalty');
    expect(penaltyLine).toBeDefined();
    // Shift 2 (07:00 - 15:00) = 8h ordinary => shortfall 240
    // Shift 3 (00:00 - 08:00) = 8h. It gets night allowance!
    //   Night allowance (15%) = 30 * 0.15 = 4.5. Effective rate = 34.5.
    //   Double-time floor = 60. Shortfall = 60 - 34.5 = 25.5/h. 25.5 * 8 = 204.
    // Total penalty = 240 + 204 = 444.
    expect(penaltyLine!.amount).toBeCloseTo(444, 2);
  });
});
