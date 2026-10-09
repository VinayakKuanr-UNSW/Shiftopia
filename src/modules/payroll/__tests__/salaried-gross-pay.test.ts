import { describe, it, expect } from 'vitest';
import { computeShiftGrossPay, type GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import {
  aggregatePeriodGrossPay,
  computeEmployeePeriodGrossPay,
} from '../domain/aggregatePeriodGrossPay';

describe('Salaried Gross Pay & Time in Lieu (cl 2.2 / NES)', () => {
  const ANNUAL_SALARY = 95000;
  const WEEKLY_HOURS = 38;
  const EMP_ID = 'emp-salaried-1';

  const bounds = {
    periodStart: '2026-07-06', // Monday
    periodEnd: '2026-07-12',   // Sunday (1 week)
  };

  it('Salaried leave day: 7.6h -> $365.38 leave pay, no 17.5% loading', () => {
    const input: GrossPayShiftInput = {
      shiftId: 'leave:1:2026-07-06',
      employeeId: EMP_ID,
      shiftDate: '2026-07-06',
      netMinutes: 456, // 7.6h
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
      isAnnualLeave: true,
    };

    const res = computeShiftGrossPay(input);
    expect(res.isLeave).toBe(true);
    expect(res.paidHours).toBe(7.6);
    expect(res.grossPay).toBe(365.38);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toEqual({
      code: 'annual_leave',
      description: 'Annual leave',
      hours: 7.6,
      amount: 365.38,
    });
  });

  it('Salaried worked shift: earns $0 per-shift pay, records salariedHours', () => {
    const input: GrossPayShiftInput = {
      shiftId: 'shift:1:2026-07-06',
      employeeId: EMP_ID,
      shiftDate: '2026-07-06',
      netMinutes: 456, // 7.6h
      startTime: '09:00',
      endTime: '17:00',
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
    };

    const res = computeShiftGrossPay(input);
    expect(res.isLeave).toBe(false);
    expect(res.grossPay).toBe(0);
    expect(res.paidHours).toBe(0);
    expect(res.salariedHours).toBe(7.6);
    expect(res.lines).toHaveLength(0);
  });

  it('Salaried week without overtime: 38h worked -> $1,826.92 gross, 0 TIL', () => {
    // 5 days x 7.6h = 38h
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const inputs: GrossPayShiftInput[] = days.map((date, idx) => ({
      shiftId: `shift:${idx}:${date}`,
      employeeId: EMP_ID,
      shiftDate: date,
      netMinutes: 456, // 7.6h
      startTime: '09:00',
      endTime: '17:00',
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
    }));

    const period = computeEmployeePeriodGrossPay(EMP_ID, inputs, bounds);
    expect(period.grossPay).toBe(1826.92);
    expect(period.paidHours).toBe(38);
    expect(period.salariedHours).toBe(38);
    expect(period.timeInLieuHours).toBe(0);
    expect(period.lines).toEqual([
      {
        code: 'ordinary',
        description: 'Salary',
        hours: 38,
        amount: 1826.92,
      },
    ]);
  });

  it('Salaried week with overtime: 45h worked -> $1,826.92 gross, 7h TIL (no cash overtime)', () => {
    // 5 days x 9h = 45h
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const inputs: GrossPayShiftInput[] = days.map((date, idx) => ({
      shiftId: `shift:${idx}:${date}`,
      employeeId: EMP_ID,
      shiftDate: date,
      netMinutes: 540, // 9h
      startTime: '08:00',
      endTime: '17:30',
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
    }));

    const period = computeEmployeePeriodGrossPay(EMP_ID, inputs, bounds);
    expect(period.grossPay).toBe(1826.92);
    expect(period.paidHours).toBe(38);
    expect(period.salariedHours).toBe(45);
    expect(period.timeInLieuHours).toBe(7);
    // Salary only, no cash overtime lines
    expect(period.lines).toEqual([
      {
        code: 'ordinary',
        description: 'Salary',
        hours: 38,
        amount: 1826.92,
      },
    ]);
  });

  it('Combined week: 1 leave day + 4 worked days -> $1,826.92 total', () => {
    // 1 annual leave day (7.6h) + 4 worked days (4 x 7.6h = 30.4h)
    const leaveInput: GrossPayShiftInput = {
      shiftId: 'leave:1:2026-07-06',
      employeeId: EMP_ID,
      shiftDate: '2026-07-06',
      netMinutes: 456,
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
      isAnnualLeave: true,
    };

    const workedDays = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const workedInputs: GrossPayShiftInput[] = workedDays.map((date, idx) => ({
      shiftId: `shift:${idx}:${date}`,
      employeeId: EMP_ID,
      shiftDate: date,
      netMinutes: 456,
      startTime: '09:00',
      endTime: '17:00',
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
    }));

    const period = computeEmployeePeriodGrossPay(EMP_ID, [leaveInput, ...workedInputs], bounds);
    expect(period.grossPay).toBe(1826.92);
    expect(period.paidHours).toBe(38);
    expect(period.salariedHours).toBe(30.4);
    expect(period.timeInLieuHours).toBe(0);
    expect(period.lines).toEqual([
      {
        code: 'ordinary',
        description: 'Salary',
        hours: 30.4,
        amount: 1461.54,
      },
      {
        code: 'annual_leave',
        description: 'Annual leave',
        hours: 7.6,
        amount: 365.38,
      },
    ]);
  });

  it('Combined week with overtime: 1 leave day + 4 long worked days (36h worked) -> 5.6h TIL', () => {
    const leaveInput: GrossPayShiftInput = {
      shiftId: 'leave:1:2026-07-06',
      employeeId: EMP_ID,
      shiftDate: '2026-07-06',
      netMinutes: 456, // 7.6h leave
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
      isAnnualLeave: true,
    };

    const workedDays = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const workedInputs: GrossPayShiftInput[] = workedDays.map((date, idx) => ({
      shiftId: `shift:${idx}:${date}`,
      employeeId: EMP_ID,
      shiftDate: date,
      netMinutes: 540, // 9h each = 36h total worked
      startTime: '08:00',
      endTime: '17:30',
      payBasis: 'salary',
      annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS,
      rate: null,
    }));

    const period = computeEmployeePeriodGrossPay(EMP_ID, [leaveInput, ...workedInputs], bounds);
    expect(period.grossPay).toBe(1826.92);
    expect(period.paidHours).toBe(38);
    expect(period.salariedHours).toBe(36);
    // Required balance hours = 38 - 7.6 = 30.4h. TIL = 36 - 30.4 = 5.6h
    expect(period.timeInLieuHours).toBe(5.6);
  });
});
