import { describe, it, expect } from 'vitest';
import {
  leaveTypeToFlags,
  eligibleLeaveDays,
  publicHolidayDaysInRange,
  buildLeaveInputs,
  buildPublicHolidayInputs,
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
    expect(leaveTypeToFlags('compassionate')).toEqual({ isCompassionate: true }); // capped 2d, priced as carer
  });

  it('returns null for leave the gross engine must not price as paid ordinary leave', () => {
    expect(leaveTypeToFlags('unpaid')).toBeNull();
    expect(leaveTypeToFlags('')).toBeNull();
    expect(leaveTypeToFlags(null)).toBeNull();
  });

  it('cl 46: family & domestic violence leave is PAID — its own flag, payslip-presented as personal leave', () => {
    // FDV now carries its own engine flag (paid for CASUALS too, NES s106B
    // as-worked rate). The FW Regulations still prohibit identifying FDV on a
    // payslip — computeShiftGrossPay emits it as a 'personal_leave' line.
    expect(leaveTypeToFlags('Family and Domestic Violence Leave')).toEqual({ isFdvLeave: true });
    expect(leaveTypeToFlags('fdv')).toEqual({ isFdvLeave: true });
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

describe('FDV leave (cl 46 / NES s106B) — paid for CASUALS at rostered as-worked hours', () => {
  const fdvReq: LeaveRequestRow = {
    id: 'req2', employee_id: 'e2', leave_type: 'fdv',
    start_date: '2026-07-06', end_date: '2026-07-09',
  };
  const casualCtx: LeaveEmployeeContext = {
    // rate 30 = the casual's LOADED rate (engine de-loads /1.25 → 24 ordinary).
    employeeId: 'e2', employmentType: 'Casual', rate: 30, dailyOrdinaryMinutes: 0,
  };

  it('pays only the days with rostered minutes, at those minutes', () => {
    const roster = new Map([['2026-07-06', 420], ['2026-07-08', 300]]); // 7h + 5h
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
    const inputs = buildLeaveInputs(fdvReq, casualCtx, days, roster);
    expect(inputs.map((i) => [i.shiftDate, i.netMinutes])).toEqual([
      ['2026-07-06', 420],
      ['2026-07-08', 300],
    ]);
    expect(inputs[0]).toMatchObject({ isFdvLeave: true, employmentType: 'Casual' });
  });

  it('pays nothing when the casual has no rostered minutes (cl 46.6: rostered hours only)', () => {
    expect(buildLeaveInputs(fdvReq, casualCtx, ['2026-07-06', '2026-07-07'])).toEqual([]);
  });

  it('prices a casual weekday FDV day at the LOADED rate (as-worked incl. 25% loading)', () => {
    const roster = new Map([['2026-07-06', 420]]); // Monday, 7h
    const [input] = buildLeaveInputs(fdvReq, casualCtx, ['2026-07-06'], roster);
    const r = computeShiftGrossPay(input);
    expect(r.isLeave).toBe(true);
    expect(r.grossPay).toBeCloseTo(7 * 30, 4); // 7h × loaded 30 (= 24 × 1.25)
    // Payslip privacy (FW Regs): the line must be indistinguishable from personal leave.
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].code).toBe('personal_leave');
    expect(r.lines[0].description).toBe("Personal / carer's leave");
  });

  it('prices a casual SATURDAY FDV day as-worked incl. the Saturday penalty (NES s106B full rate)', () => {
    const satReq = { ...fdvReq, start_date: '2026-07-11', end_date: '2026-07-11' };
    const roster = new Map([['2026-07-11', 420]]); // Saturday, 7h
    const [input] = buildLeaveInputs(satReq, casualCtx, ['2026-07-11'], roster);
    const r = computeShiftGrossPay(input);
    // ordinary 24 × (1.25 loading + 0.25 Sat) = 36/h → 7h × 36
    expect(r.grossPay).toBeCloseTo(7 * 36, 4);
  });

  it('prices a PERMANENT FDV day flat at the ordinary rate on a weekday', () => {
    const ftCtx: LeaveEmployeeContext = {
      employeeId: 'e2', employmentType: 'Full-Time', rate: 30, dailyOrdinaryMinutes: 456,
    };
    const [input] = buildLeaveInputs(fdvReq, ftCtx, ['2026-07-06']);
    const r = computeShiftGrossPay(input);
    expect(r.grossPay).toBeCloseTo(7.6 * 30, 4);
    expect(r.lines[0].code).toBe('personal_leave');
  });
});

describe('compassionate leave (cl 48) — 2 paid days per occasion, priced as carer', () => {
  const req: LeaveRequestRow = {
    id: 'req3', employee_id: 'e3', leave_type: 'compassionate',
    start_date: '2026-07-06', end_date: '2026-07-10',
  };
  const ftCtx: LeaveEmployeeContext = {
    employeeId: 'e3', employmentType: 'Full-Time', rate: 30, dailyOrdinaryMinutes: 456,
  };

  it('caps a 5-day request at 2 paid days and emits the carer flag (engine-visible)', () => {
    const days = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const inputs = buildLeaveInputs(req, ftCtx, days);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ isCarerLeave: true });
    expect((inputs[0] as unknown as Record<string, unknown>).isCompassionate).toBeUndefined();
    const r = computeShiftGrossPay(inputs[0]);
    expect(r.grossPay).toBeCloseTo(228, 4); // flat ordinary 7.6h × 30
  });
});

describe('public holidays inside a leave range (cl 44.8 / 56.4)', () => {
  // 2026-01-26 (Australia Day) is a Monday. Leave range Fri 23 Jan → Wed 28 Jan.
  const isHoliday = (ymd: string) => ymd === '2026-01-26';
  const req: LeaveRequestRow = {
    id: 'req2', employee_id: 'e1', leave_type: 'Annual Leave',
    start_date: '2026-01-23', end_date: '2026-01-28',
  };
  const ftCtx: LeaveEmployeeContext = {
    employeeId: 'e1', employmentType: 'Full-Time', rate: 30, dailyOrdinaryMinutes: 456, // 7.6h
  };

  it('the PH is excluded from leave days but returned as a public-holiday day', () => {
    const leaveDays = eligibleLeaveDays('2026-01-23', '2026-01-28', '2026-01-19', '2026-02-01', isHoliday);
    expect(leaveDays).toEqual(['2026-01-23', '2026-01-27', '2026-01-28']);
    const phDays = publicHolidayDaysInRange('2026-01-23', '2026-01-28', '2026-01-19', '2026-02-01', isHoliday);
    expect(phDays).toEqual(['2026-01-26']);
  });

  it('builds a cl 56.4 public-holiday input for a permanent, none for a casual', () => {
    const inputs = buildPublicHolidayInputs(req, ftCtx, ['2026-01-26']);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      shiftDate: '2026-01-26', isPublicHolidayNotWorked: true, netMinutes: 456,
      shiftId: 'ph:req2:2026-01-26',
    });
    expect(buildPublicHolidayInputs(req, { ...ftCtx, employmentType: 'Casual' }, ['2026-01-26'])).toEqual([]);
  });

  it('the PH day is paid at the ordinary rate under its own earnings code — no loading, no leave', () => {
    const [input] = buildPublicHolidayInputs(req, ftCtx, ['2026-01-26']);
    const r = computeShiftGrossPay(input);
    expect(r.grossPay).toBeCloseTo(228, 5); // 7.6h * 30 flat — NOT 267.90 (no 17.5%)
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].code).toBe('public_holiday');
  });
});

describe('weekly OT — paid absences never trigger overtime on later worked shifts (cl 42.1)', () => {
  it('4 leave days + a worked Friday shift stay ordinary (leave hours are not "time worked")', () => {
    const req: LeaveRequestRow = {
      id: 'req3', employee_id: 'e1', leave_type: 'Annual Leave',
      start_date: '2026-07-06', end_date: '2026-07-09', // Mon–Thu
    };
    const ftCtx: LeaveEmployeeContext = {
      employeeId: 'e1', employmentType: 'Full-Time', rate: 30, dailyOrdinaryMinutes: 480, // 8h
    };
    const leaveInputs = buildLeaveInputs(req, ftCtx, ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']);
    const worked = {
      shiftId: 's-fri', employeeId: 'e1', shiftDate: '2026-07-10',
      netMinutes: 480, scheduledLengthMinutes: 480, startTime: '09:00', endTime: '17:00',
      rate: 30, employmentType: 'Full-Time' as const, hoursSource: 'actual' as const,
    };
    const period = computeEmployeePeriodGrossPay('e1', [...leaveInputs, worked], {
      periodStart: '2026-07-06', periodEnd: '2026-07-12',
    });
    // 32h leave + 8h worked = 40h in the ISO week, but the worked Friday must be
    // 8h ORDINARY (240), not 2h ordinary + 6h OT — leave is not time worked.
    const ot = period.lines.find((l) => l.code === 'overtime');
    expect(ot).toBeUndefined();
    const ordinary = period.lines.find((l) => l.code === 'ordinary');
    expect(ordinary?.amount).toBeCloseTo(240, 4);
  });
});
