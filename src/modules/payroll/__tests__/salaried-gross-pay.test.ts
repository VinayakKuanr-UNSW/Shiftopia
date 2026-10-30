import { describe, it, expect } from 'vitest';
import { computeShiftGrossPay, type GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import {
  computeEmployeePeriodGrossPay,
} from '../domain/aggregatePeriodGrossPay';
import { dailyAccrualMinutes, weeklyTopupMinutes } from '../../toil/domain/toil-rules';
import { buildLeaveInputs, buildPublicHolidayInputs } from '../data/leaveGrossPay';

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

    // What the TOIL ledger books for this week: 5 × (9h − 7.6h) = 7h daily,
    // and the weekly rule adds nothing more (45 − 38 − 7 = 0).
    const daily = days.reduce((s) => s + dailyAccrualMinutes([540]), 0);
    const weekly = weeklyTopupMinutes({ workedMinutes: 2700, contractedMinutes: 2280, absenceCreditMinutes: 0, dailyAccruedMinutes: daily });
    expect(daily + weekly).toBe(420);

    const period = computeEmployeePeriodGrossPay(EMP_ID, inputs, bounds, { toil: { accruedHours: (daily + weekly) / 60 } });
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

    // Ledger: 4 × 1.4h daily = 5.6h; the week requires 38 − 7.6 (leave) = 30.4h,
    // 36 − 30.4 − 5.6 = 0 more from the weekly rule.
    const period = computeEmployeePeriodGrossPay(EMP_ID, [leaveInput, ...workedInputs], bounds, { toil: { accruedHours: 5.6 } });
    expect(period.grossPay).toBe(1826.92);
    expect(period.paidHours).toBe(38);
    expect(period.salariedHours).toBe(36);
    expect(period.timeInLieuHours).toBe(5.6);
  });

  it('a public holiday inside salaried annual leave is paid once, inside the salary', () => {
    const ctx = {
      employeeId: EMP_ID, employmentType: 'Full-Time' as const, payBasis: 'salary' as const,
      annualSalary: ANNUAL_SALARY, contractedWeeklyHours: WEEKLY_HOURS,
      rate: ANNUAL_SALARY / 52 / WEEKLY_HOURS, dailyOrdinaryMinutes: 456,
    };
    const req = { id: 'r', employee_id: EMP_ID, leave_type: 'annual', start_date: '2026-07-06', end_date: '2026-07-10' };
    const leave = buildLeaveInputs(req, ctx, ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']);
    const ph = buildPublicHolidayInputs(req, ctx, ['2026-07-06']);
    const period = computeEmployeePeriodGrossPay(EMP_ID, [...leave, ...ph], bounds);
    // One week's salary — it used to be $2,192.30, the holiday paid on top.
    expect(period.grossPay).toBe(1826.92);
    expect(period.lines.find(l => l.code === 'public_holiday')?.hours).toBe(7.6);
  });

  it('time in lieu is the LEDGER figure, not worked − contracted over the period', () => {
    // Mon 10h, Tue 5h, Wed–Fri 7.6h = 37.8h. Worked − contracted would say 0;
    // the daily rule banks Monday's 2.4h — a long day is not cancelled by a short one.
    const nets = [600, 300, 456, 456, 456];
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const inputs: GrossPayShiftInput[] = days.map((date, i) => ({
      shiftId: `shift:${i}`, employeeId: EMP_ID, shiftDate: date, netMinutes: nets[i],
      startTime: '08:00', endTime: '18:00', payBasis: 'salary', annualSalary: ANNUAL_SALARY,
      contractedWeeklyHours: WEEKLY_HOURS, rate: null,
    }));
    const banked = nets.reduce((s, n) => s + dailyAccrualMinutes([n]), 0);
    expect(banked).toBe(144);

    expect(computeEmployeePeriodGrossPay(EMP_ID, inputs, bounds).timeInLieuHours).toBe(0);
    expect(computeEmployeePeriodGrossPay(EMP_ID, inputs, bounds, { toil: { accruedHours: banked / 60 } }).timeInLieuHours).toBe(2.4);
  });
});
