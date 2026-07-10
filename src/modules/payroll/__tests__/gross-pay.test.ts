import { describe, it, expect } from 'vitest';
import {
  computeShiftGrossPay,
  aggregatePeriodGrossPay,
  computeEmployeePeriodGrossPay,
  isoWeekKey,
  type GrossPayShiftInput,
} from '../index';
import type { EarningsCode } from '../model/gross-pay.types';

/**
 * Gross-pay engine tests. The award calculator is separately locked; here we
 * verify the payslip DECOMPOSITION, the not-worked / leave short-circuits, the
 * period rollup, and that weekly overtime is driven by the real shift sequence.
 *
 * Dates: 2026-07-04 = Sat, 07-05 = Sun, 07-06 = Mon … 07-09 = Thu (none PH).
 */
const shift = (o: Partial<GrossPayShiftInput>): GrossPayShiftInput => ({
  shiftId: 's1',
  employeeId: 'e1',
  shiftDate: '2026-07-06',
  netMinutes: 480,
  startTime: '09:00',
  endTime: '17:00',
  scheduledLengthMinutes: 480,
  isOvernight: false,
  rate: 30,
  employmentType: 'Full-Time',
  ...o,
});

const line = (lines: { code: EarningsCode; amount: number; hours?: number }[], code: EarningsCode) =>
  lines.find((l) => l.code === code);

describe('computeShiftGrossPay — line itemisation (Standard)', () => {
  it('a weekday FT day shift is a single ordinary line', () => {
    const r = computeShiftGrossPay(shift({}));
    expect(r.lines).toHaveLength(1);
    expect(line(r.lines, 'ordinary')!.amount).toBeCloseTo(240, 5); // 8h * 30
    expect(line(r.lines, 'ordinary')!.hours).toBe(8);
    expect(r.grossPay).toBeCloseTo(240, 5);
    expect(r.paidHours).toBe(8);
    expect(r.overtimeHours).toBe(0);
  });

  it('a Saturday casual shift splits ordinary base from the weekend penalty', () => {
    const r = computeShiftGrossPay(shift({
      shiftDate: '2026-07-04', endTime: '14:00', netMinutes: 300, scheduledLengthMinutes: 300,
      employmentType: 'Casual', rate: 37.5, // ordinary 30
    }));
    const baseLine = r.lines.find(l => l.description.includes('Base rate'));
    const casualLine = r.lines.find(l => l.description.includes('Casual loading'));
    const satLine = r.lines.find(l => l.description.includes('Saturday loading'));

    expect(baseLine!.amount).toBeCloseTo(150, 5);
    expect(casualLine!.amount).toBeCloseTo(37.5, 5);
    expect(satLine!.amount).toBeCloseTo(37.5, 5);
    expect(r.grossPay).toBeCloseTo(225, 5);
  });

  it('an overnight Sat→Sun casual shift yields ordinary + penalty + night lines that reconcile', () => {
    const input = shift({
      shiftDate: '2026-07-04', startTime: '22:00', endTime: '06:00', isOvernight: true,
      netMinutes: 480, scheduledLengthMinutes: 480, employmentType: 'Casual', rate: 37.5,
    });
    const r = computeShiftGrossPay(input);
    const baseLine = r.lines.find(l => l.description.includes('Base rate'));
    const casualLine = r.lines.find(l => l.description.includes('Casual loading'));
    const satLine = r.lines.find(l => l.description.includes('Saturday loading'));
    const sunLine = r.lines.find(l => l.description.includes('Sunday loading'));
    const nightLine = r.lines.find(l => l.description.includes('Night-shift allowance'));

    expect(baseLine!.amount).toBeCloseTo(240, 5);
    expect(casualLine!.amount).toBeCloseTo(60, 5);
    expect(satLine!.amount).toBeCloseTo(15, 5);
    expect(sunLine!.amount).toBeCloseTo(90, 5);
    expect(nightLine!.amount).toBeCloseTo(15, 5);
    expect(r.grossPay).toBeCloseTo(420, 5);
    const sumOfLines = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(r.grossPay).toBeCloseTo(sumOfLines, 5);
  });
});

describe('computeShiftGrossPay — not-worked & leave short-circuits', () => {
  it('a no-show is not paid', () => {
    const r = computeShiftGrossPay(shift({ isNoShow: true }));
    expect(r.grossPay).toBe(0);
    expect(r.lines).toHaveLength(0);
    expect(r.hoursSource).toBe('none');
    expect(r.paidHours).toBe(0);
  });

  it('a cancelled shift is not paid', () => {
    const r = computeShiftGrossPay(shift({ isCancelled: true }));
    expect(r.grossPay).toBe(0);
    expect(r.lines).toHaveLength(0);
  });

  it('annual leave is a single leave line with the 17.5% loading, no OT/allowance', () => {
    const r = computeShiftGrossPay(shift({ isAnnualLeave: true }));
    expect(r.isLeave).toBe(true);
    expect(line(r.lines, 'annual_leave')!.amount).toBeCloseTo(282, 5); // 8*30*1.175
    expect(line(r.lines, 'overtime')).toBeUndefined();
    expect(r.grossPay).toBeCloseTo(282, 5);
  });

  it('a casual accrues no paid leave ⇒ $0', () => {
    const r = computeShiftGrossPay(shift({ isAnnualLeave: true, employmentType: 'Casual', rate: 37.5 }));
    expect(r.grossPay).toBe(0);
  });
});

describe('computeShiftGrossPay — Security engine mapping', () => {
  it('annualised full-time security weekday: ordinary earnings, no penalty', () => {
    const r = computeShiftGrossPay(shift({ isSecurityRole: true, rate: 32.20 }));
    const baseLine = r.lines.find(l => l.description.includes('Base rate'));
    expect(baseLine!.amount).toBeCloseTo(257.6, 5); // 8 * 32.20
    expect(r.lines.find(l => l.description.includes('loading'))).toBeUndefined();
    expect(r.grossPay).toBeCloseTo(257.6, 5);
  });

  it('casual event-security Saturday: ordinary + additive penalty line', () => {
    const r = computeShiftGrossPay(shift({
      isSecurityRole: true, shiftDate: '2026-07-04', endTime: '14:00',
      netMinutes: 300, scheduledLengthMinutes: 300, employmentType: 'Casual', rate: 40,
    }));
    const baseLine = r.lines.find(l => l.description.includes('Base rate'));
    const casualLine = r.lines.find(l => l.description.includes('Casual loading'));
    const satLine = r.lines.find(l => l.description.includes('Saturday loading'));

    expect(baseLine!.amount).toBeCloseTo(160, 5); // 5 * 32
    expect(casualLine!.amount).toBeCloseTo(40, 5);
    expect(satLine!.amount).toBeCloseTo(40, 5);
    expect(r.grossPay).toBeCloseTo(240, 5);
  });
});

describe('aggregatePeriodGrossPay — per-employee period rollup', () => {
  it('sums earnings lines by code and excludes out-of-period / other-employee shifts', () => {
    const inPeriodA = computeShiftGrossPay(shift({ shiftId: 'a', shiftDate: '2026-07-06' }));
    const inPeriodB = computeShiftGrossPay(shift({ shiftId: 'b', shiftDate: '2026-07-07' }));
    const outOfPeriod = computeShiftGrossPay(shift({ shiftId: 'c', shiftDate: '2026-07-20' }));
    const otherEmp = computeShiftGrossPay(shift({ shiftId: 'd', employeeId: 'e2', shiftDate: '2026-07-08' }));

    const period = aggregatePeriodGrossPay('e1', [inPeriodA, inPeriodB, outOfPeriod, otherEmp], {
      periodStart: '2026-07-06', periodEnd: '2026-07-12',
    });
    expect(period.shiftCount).toBe(2);
    expect(line(period.lines, 'ordinary')!.amount).toBeCloseTo(480, 5); // 240 + 240
    expect(line(period.lines, 'ordinary')!.hours).toBe(16);
    expect(period.grossPay).toBeCloseTo(480, 5);
    expect(period.paidHours).toBe(16);
  });
});

describe('computeEmployeePeriodGrossPay — weekly overtime driven by the shift sequence (cl 42)', () => {
  it('four 10h weekday FT shifts in one ISO week bill 38h ordinary + 2h weekly OT', () => {
    const inputs: GrossPayShiftInput[] = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'].map((d, i) =>
      shift({ shiftId: `w${i}`, shiftDate: d, startTime: '09:00', endTime: '19:00', netMinutes: 600, scheduledLengthMinutes: 600 }),
    );
    const period = computeEmployeePeriodGrossPay('e1', inputs, { periodStart: '2026-07-06', periodEnd: '2026-07-12' });

    // 38h ordinary @30 = 1140; 2h weekly OT @1.5*30 = 90.
    expect(line(period.lines, 'ordinary')!.hours).toBeCloseTo(38, 5);
    expect(line(period.lines, 'ordinary')!.amount).toBeCloseTo(1140, 5);
    expect(line(period.lines, 'overtime')!.hours).toBeCloseTo(2, 5);
    expect(line(period.lines, 'overtime')!.amount).toBeCloseTo(90, 5);
    expect(period.grossPay).toBeCloseTo(1230, 5);
    expect(period.paidHours).toBeCloseTo(40, 5);
  });

  it('the same four shifts as a CASUAL get no weekly OT (all 40h ordinary)', () => {
    const inputs: GrossPayShiftInput[] = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'].map((d, i) =>
      shift({ shiftId: `c${i}`, shiftDate: d, startTime: '09:00', endTime: '19:00', netMinutes: 600, scheduledLengthMinutes: 600, employmentType: 'Casual', rate: 37.5 }),
    );
    const period = computeEmployeePeriodGrossPay('e1', inputs, { periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    expect(line(period.lines, 'overtime')).toBeUndefined();
    expect(line(period.lines, 'ordinary')!.hours).toBeCloseTo(40, 5);
  });
});

describe('isoWeekKey', () => {
  it('anchors every weekday to the same Monday', () => {
    expect(isoWeekKey('2026-07-06')).toBe('2026-07-06'); // Monday
    expect(isoWeekKey('2026-07-09')).toBe('2026-07-06'); // Thursday
    expect(isoWeekKey('2026-07-12')).toBe('2026-07-06'); // Sunday (same ISO week)
    expect(isoWeekKey('2026-07-13')).toBe('2026-07-13'); // next Monday
  });
});
