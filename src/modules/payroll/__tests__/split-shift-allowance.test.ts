import { describe, it, expect } from 'vitest';
import {
  computeEmployeePeriodGrossPay,
  type PeriodBounds,
} from '../domain/aggregatePeriodGrossPay';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { EarningsCode } from '../model/gross-pay.types';

// FY26/27 rate era (in force from 6 Jul 2026) — split-shift allowance $11.70/shift.
const SPLIT_SHIFT_ALLOWANCE = 11.70;

const bounds: PeriodBounds = {
  periodStart: '2026-07-06',
  periodEnd: '2026-07-12',
};

const shift = (o: Partial<GrossPayShiftInput>): GrossPayShiftInput => ({
  shiftId: 's1',
  employeeId: 'e1',
  shiftDate: '2026-07-06',
  netMinutes: 240,
  startTime: '09:00',
  endTime: '13:00',
  scheduledLengthMinutes: 240,
  isOvernight: false,
  rate: 30,
  employmentType: 'Part-Time',
  classificationLevel: 'LEVEL_3',
  ...o,
});

const otherAllowanceTotal = (lines: { code: EarningsCode; amount: number }[]) =>
  lines.filter((l) => l.code === 'other_allowance').reduce((s, l) => s + l.amount, 0);

describe('aggregatePeriodGrossPay — cl 39/28.4 split-shift allowance auto-derivation (audit M-6)', () => {
  it('pays the allowance exactly once for a PT same-day pair with a <=3h gap', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '13:00' }),
      shift({ shiftId: 's2', startTime: '15:00', endTime: '19:00' }), // 2h gap
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBeCloseTo(SPLIT_SHIFT_ALLOWANCE, 2);
  });

  it('does not pay the allowance for a gap over 3 hours', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '13:00' }),
      shift({ shiftId: 's2', startTime: '17:00', endTime: '21:00' }), // 4h gap
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBe(0);
  });

  it('excludes Casual employees (cl 39.1)', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '13:00', employmentType: 'Casual', rate: 37.5 }),
      shift({ shiftId: 's2', startTime: '15:00', endTime: '19:00', employmentType: 'Casual', rate: 37.5 }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBe(0);
  });

  it('excludes Full-Time employees — the mis-scoping this audit fixed (M-6)', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '13:00', employmentType: 'Full-Time' }),
      shift({ shiftId: 's2', startTime: '15:00', endTime: '19:00', employmentType: 'Full-Time' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBe(0);
  });

  it('applies to Flexible Part-Time employees too', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '13:00', employmentType: 'Flexible Part-Time' }),
      shift({ shiftId: 's2', startTime: '15:00', endTime: '19:00', employmentType: 'Flexible Part-Time' }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBeCloseTo(SPLIT_SHIFT_ALLOWANCE, 2);
  });

  it('does not fire for a single shift on the day', () => {
    const inputs = [shift({ shiftId: 's1', startTime: '09:00', endTime: '17:00' })];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBe(0);
  });
});

describe('computeShiftGrossPay — cl 28.2 first-aid allowance wiring (audit H-6)', () => {
  it('pays the first-aid allowance when allowances.firstAid is supplied', () => {
    const inputs = [
      shift({ shiftId: 's1', startTime: '09:00', endTime: '17:00', employmentType: 'Full-Time', allowances: { firstAid: true } }),
    ];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBeGreaterThan(0);
  });

  it('pays nothing extra when no allowances are supplied', () => {
    const inputs = [shift({ shiftId: 's1', startTime: '09:00', endTime: '17:00', employmentType: 'Full-Time' })];
    const period = computeEmployeePeriodGrossPay('e1', inputs, bounds);
    expect(otherAllowanceTotal(period.lines)).toBe(0);
  });
});
