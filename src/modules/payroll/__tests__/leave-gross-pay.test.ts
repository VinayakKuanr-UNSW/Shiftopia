import { describe, it, expect } from 'vitest';
import {
  leaveTypeToFlags,
  eligibleLeaveDays,
  buildLeaveInputs,
  type LeaveEmployeeContext,
  type LeaveRequestRow,
} from '../data/leaveGrossPay';
import { computeShiftGrossPay } from '../domain/computeShiftGrossPay';
import { computeEmployeePeriodGrossPay } from '../domain/aggregatePeriodGrossPay';

/**
 * Leave-day synthesis (closes the "leave not detected" gap). Dates: 2026-07-06
 * Mon … 07-10 Fri, 07-11 Sat, 07-12 Sun.
 */
describe('leaveTypeToFlags', () => {
  it('maps paid leave families to the right flag', () => {
    expect(leaveTypeToFlags('Annual Leave')).toEqual({ isAnnualLeave: true });
    expect(leaveTypeToFlags('recreation_leave')).toEqual({ isAnnualLeave: true });
    expect(leaveTypeToFlags('Personal/Carer Leave')).toEqual({ isCarerLeave: true }); // carer wins
    expect(leaveTypeToFlags('sick')).toEqual({ isPersonalLeave: true });
    expect(leaveTypeToFlags('compassionate')).toEqual({ isCarerLeave: true });
  });

  it('returns null for leave the gross engine must not price as paid ordinary leave', () => {
    expect(leaveTypeToFlags('long service leave')).toBeNull();
    expect(leaveTypeToFlags('unpaid')).toBeNull();
    expect(leaveTypeToFlags('parental')).toBeNull();
    expect(leaveTypeToFlags('')).toBeNull();
    expect(leaveTypeToFlags(null)).toBeNull();
  });
});

describe('eligibleLeaveDays', () => {
  it('returns Mon–Fri within the range, excluding weekends', () => {
    const days = eligibleLeaveDays('2026-07-06', '2026-07-12', '2026-07-06', '2026-07-12');
    expect(days).toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']);
  });

  it('excludes public holidays via the injected predicate', () => {
    const days = eligibleLeaveDays('2026-07-06', '2026-07-10', '2026-07-06', '2026-07-12',
      (d) => d === '2026-07-08');
    expect(days).toEqual(['2026-07-06', '2026-07-07', '2026-07-09', '2026-07-10']);
  });

  it('clips to the pay period and handles no overlap', () => {
    expect(eligibleLeaveDays('2026-07-01', '2026-07-20', '2026-07-06', '2026-07-12'))
      .toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']);
    expect(eligibleLeaveDays('2026-08-01', '2026-08-05', '2026-07-06', '2026-07-12')).toEqual([]);
  });

  it('accepts timestamptz inputs (strips the time component)', () => {
    const days = eligibleLeaveDays('2026-07-06T00:00:00+10:00', '2026-07-07T09:30:00Z', '2026-07-06', '2026-07-12');
    expect(days).toEqual(['2026-07-06', '2026-07-07']);
  });
});

describe('buildLeaveInputs', () => {
  const req: LeaveRequestRow = {
    id: 'req1', employee_id: 'e1', leave_type: 'Annual Leave',
    start_date: '2026-07-06', end_date: '2026-07-10',
  };
  const ftCtx: LeaveEmployeeContext = {
    employeeId: 'e1', employmentType: 'Full-Time', rate: 30, dailyOrdinaryMinutes: 456, // 7.6h
  };

  it('emits one leave input per eligible day with the flag + rate + hours', () => {
    const inputs = buildLeaveInputs(req, ftCtx, ['2026-07-06', '2026-07-07']);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      employeeId: 'e1', shiftDate: '2026-07-06', netMinutes: 456, rate: 30,
      isAnnualLeave: true, shiftId: 'leave:req1:2026-07-06',
    });
  });

  it('emits nothing for a casual (no paid leave accrual), a null leave type, or no days', () => {
    expect(buildLeaveInputs(req, { ...ftCtx, employmentType: 'Casual' }, ['2026-07-06'])).toEqual([]);
    expect(buildLeaveInputs({ ...req, leave_type: 'unpaid' }, ftCtx, ['2026-07-06'])).toEqual([]);
    expect(buildLeaveInputs(req, ftCtx, [])).toEqual([]);
  });

  it('the award engine prices a synthesised annual-leave day at ordinary + 17.5%', () => {
    const [input] = buildLeaveInputs(req, ftCtx, ['2026-07-06']);
    const r = computeShiftGrossPay(input);
    expect(r.isLeave).toBe(true);
    expect(r.grossPay).toBeCloseTo(267.9, 5); // 7.6h * 30 * 1.175
  });

  it('personal/carer leave is priced flat (no loading)', () => {
    const [input] = buildLeaveInputs({ ...req, leave_type: 'sick' }, ftCtx, ['2026-07-06']);
    const r = computeShiftGrossPay(input);
    expect(r.grossPay).toBeCloseTo(228, 5); // 7.6h * 30
  });

  it('a full leave week rolls up into one annual-leave earnings line', () => {
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const inputs = buildLeaveInputs(req, ftCtx, days);
    const period = computeEmployeePeriodGrossPay('e1', inputs, { periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    const annual = period.lines.find((l) => l.code === 'annual_leave');
    expect(annual?.amount).toBeCloseTo(5 * 267.9, 4); // 1339.50
    expect(period.grossPay).toBeCloseTo(1339.5, 4);
  });
});
