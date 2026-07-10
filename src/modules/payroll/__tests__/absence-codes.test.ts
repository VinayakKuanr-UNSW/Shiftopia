import { describe, it, expect } from 'vitest';
import {
  leaveTypeToFlags,
  buildLeaveInputs,
  paidDaysFromLeaveStart,
  eligibleLeaveDays,
  PARENTAL_LEAVE_CAP_DAYS,
  JURY_DUTY_CAP_DAYS,
  SUPPORTING_CARER_CAP_DAYS,
  type LeaveRequestRow,
  type LeaveEmployeeContext,
} from '../data/leaveGrossPay';
import { computeShiftGrossPay, type GrossPayShiftInput } from '../domain/computeShiftGrossPay';
import type { EarningsCode } from '../model/gross-pay.types';

const ftCtx: LeaveEmployeeContext = {
  employeeId: 'e1',
  employmentType: 'Full-Time',
  rate: 30,
  classificationLevel: 'LEVEL_3',
  dailyOrdinaryMinutes: 456, // 7.6h
};

const line = (lines: { code: EarningsCode; amount: number }[], code: EarningsCode) =>
  lines.find((l) => l.code === code);

// ── leaveTypeToFlags: new leave types ────────────────────────────────────────

describe('leaveTypeToFlags — new absence types', () => {
  it('maps parental leave variants', () => {
    expect(leaveTypeToFlags('Parental Leave')).toEqual({ isParentalLeave: true });
    expect(leaveTypeToFlags('maternity')).toEqual({ isParentalLeave: true });
    expect(leaveTypeToFlags('adoption')).toEqual({ isParentalLeave: true });
    // Paternity = SECONDARY carer under this EBA ⇒ cl 52 supporting carer
    // (1 week), NOT cl 51 parental (10 weeks) — a 10× pay difference.
    expect(leaveTypeToFlags('paternity')).toEqual({ isSupportingCarer: true });
  });

  it('maps long service leave', () => {
    expect(leaveTypeToFlags('Long Service Leave')).toEqual({ isLongServiceLeave: true });
    expect(leaveTypeToFlags('LSL')).toEqual({ isLongServiceLeave: true });
    expect(leaveTypeToFlags('long service')).toEqual({ isLongServiceLeave: true });
  });

  it('maps jury duty', () => {
    expect(leaveTypeToFlags('Jury Duty')).toEqual({ isJuryDuty: true });
    expect(leaveTypeToFlags('court')).toEqual({ isJuryDuty: true });
    expect(leaveTypeToFlags('jury service')).toEqual({ isJuryDuty: true });
  });

  it('maps supporting carer', () => {
    expect(leaveTypeToFlags('Supporting Carer Leave')).toEqual({ isSupportingCarer: true });
    expect(leaveTypeToFlags('partner leave')).toEqual({ isSupportingCarer: true });
    // The bare word "support" is deliberately NOT matched — far too loose to
    // silently decide a pay category.
    expect(leaveTypeToFlags('support')).toBeNull();
  });

  it('still maps original types correctly', () => {
    expect(leaveTypeToFlags('Annual Leave')).toEqual({ isAnnualLeave: true });
    expect(leaveTypeToFlags('sick')).toEqual({ isPersonalLeave: true });
    expect(leaveTypeToFlags('compassionate')).toEqual({ isCompassionate: true }); // capped 2d, priced as carer
    expect(leaveTypeToFlags('fdv')).toEqual({ isFdvLeave: true }); // paid incl. casuals (cl 46.6)
  });

  it('returns null for truly unpriced types', () => {
    expect(leaveTypeToFlags('unpaid')).toBeNull();
    expect(leaveTypeToFlags('')).toBeNull();
    expect(leaveTypeToFlags(null)).toBeNull();
  });
});

// ── Day caps ─────────────────────────────────────────────────────────────────

describe('buildLeaveInputs — day caps', () => {
  const req: LeaveRequestRow = {
    id: 'req1',
    employee_id: 'e1',
    leave_type: 'Parental Leave',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  };

  it('caps parental leave at 50 working days', () => {
    // Generate 260 working days (full year)
    const allDays: string[] = [];
    const cur = new Date('2026-01-01T00:00:00');
    const end = new Date('2026-12-31T00:00:00');
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        allDays.push(cur.toISOString().split('T')[0]);
      }
      cur.setDate(cur.getDate() + 1);
    }

    const inputs = buildLeaveInputs(req, ftCtx, allDays);
    expect(inputs.length).toBe(PARENTAL_LEAVE_CAP_DAYS); // 50
    expect(inputs[0].isParentalLeave).toBe(true);
  });

  it('caps jury duty at 10 days', () => {
    const juryReq: LeaveRequestRow = { ...req, leave_type: 'Jury Duty' };
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date('2026-07-06T00:00:00');
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    }).filter((d) => {
      const dow = new Date(d + 'T00:00:00').getDay();
      return dow !== 0 && dow !== 6;
    });

    const inputs = buildLeaveInputs(juryReq, ftCtx, days);
    expect(inputs.length).toBe(JURY_DUTY_CAP_DAYS); // 10
    expect(inputs[0].isJuryDuty).toBe(true);
  });

  it('caps supporting carer at ONE week — 5 days (cl 52.2)', () => {
    const carerReq: LeaveRequestRow = { ...req, leave_type: 'Supporting Carer Leave' };
    const days = Array.from({ length: 20 }, (_, i) => `2026-07-${String(6 + i).padStart(2, '0')}`);

    const inputs = buildLeaveInputs(carerReq, ftCtx, days);
    expect(inputs.length).toBe(SUPPORTING_CARER_CAP_DAYS); // 5
    expect(inputs[0].isSupportingCarer).toBe(true);
  });

  it('anchors the cap to the LEAVE START across pay periods (paidDaysFromLeaveStart)', () => {
    // A 12-month parental range: only the first 50 working days are payable.
    // A pay period in April 2026 sits entirely BEYOND that window — its
    // intersection with the allowed set must be empty, no matter that the
    // period itself only contains ~5 eligible days.
    const allowed = paidDaysFromLeaveStart('2026-01-01', '2026-12-31', PARENTAL_LEAVE_CAP_DAYS);
    expect(allowed.size).toBe(PARENTAL_LEAVE_CAP_DAYS);

    const aprilDays = eligibleLeaveDays('2026-01-01', '2026-12-31', '2026-04-13', '2026-04-19')
      .filter((d) => allowed.has(d));
    expect(aprilDays).toEqual([]);

    // A period inside the first 10 weeks IS payable.
    const febDays = eligibleLeaveDays('2026-01-01', '2026-12-31', '2026-02-02', '2026-02-08')
      .filter((d) => allowed.has(d));
    expect(febDays.length).toBe(5);
  });

  it('does not cap annual leave', () => {
    const annualReq: LeaveRequestRow = { ...req, leave_type: 'Annual Leave' };
    const days = Array.from({ length: 20 }, (_, i) => `2026-07-${String(6 + i).padStart(2, '0')}`);
    const inputs = buildLeaveInputs(annualReq, ftCtx, days);
    expect(inputs.length).toBe(20);
  });
});

// ── computeShiftGrossPay: new leave earnings codes ──────────────────────────

describe('computeShiftGrossPay — new leave earnings codes', () => {
  const baseShift = (flags: Partial<GrossPayShiftInput>): GrossPayShiftInput => ({
    shiftId: 's1',
    employeeId: 'e1',
    shiftDate: '2026-07-06',
    netMinutes: 456, // 7.6h
    startTime: '09:00',
    endTime: '16:36',
    scheduledLengthMinutes: 456,
    isOvernight: false,
    rate: 30,
    employmentType: 'Full-Time',
    ...flags,
  });

  it('routes parental leave to parental_leave code', () => {
    const r = computeShiftGrossPay(baseShift({ isParentalLeave: true }));
    expect(r.isLeave).toBe(true);
    expect(line(r.lines, 'parental_leave')).toBeDefined();
    expect(line(r.lines, 'parental_leave')!.amount).toBeGreaterThan(0);
  });

  it('routes long service leave to long_service_leave code', () => {
    const r = computeShiftGrossPay(baseShift({ isLongServiceLeave: true }));
    expect(r.isLeave).toBe(true);
    expect(line(r.lines, 'long_service_leave')).toBeDefined();
  });

  it('routes jury duty to jury_duty code', () => {
    const r = computeShiftGrossPay(baseShift({ isJuryDuty: true }));
    expect(r.isLeave).toBe(true);
    expect(line(r.lines, 'jury_duty')).toBeDefined();
  });

  it('routes supporting carer to supporting_carer code', () => {
    const r = computeShiftGrossPay(baseShift({ isSupportingCarer: true }));
    expect(r.isLeave).toBe(true);
    expect(line(r.lines, 'supporting_carer')).toBeDefined();
  });

  it('new leave codes are priced at ordinary base (no overtime, no penalties)', () => {
    for (const flag of ['isParentalLeave', 'isLongServiceLeave', 'isJuryDuty', 'isSupportingCarer'] as const) {
      const r = computeShiftGrossPay(baseShift({ [flag]: true }));
      expect(r.overtimeHours).toBe(0);
      expect(line(r.lines, 'overtime')).toBeUndefined();
      expect(line(r.lines, 'penalty')).toBeUndefined();
    }
  });

  it('a SATURDAY LSL day is flat base — the engine must not price the absence as worked', () => {
    // Pre-fix, these flags never reached the engine's leave path, so a
    // roster-aware Saturday absence picked up the 25% weekend penalty.
    const r = computeShiftGrossPay(baseShift({
      isLongServiceLeave: true, shiftDate: '2026-07-04', // Saturday
      netMinutes: 456, scheduledLengthMinutes: 456,
    }));
    expect(r.grossPay).toBeCloseTo(7.6 * 30, 2); // 228 flat — no 1.25× Saturday loading
    expect(line(r.lines, 'long_service_leave')!.amount).toBeCloseTo(228, 2);
  });

  it('a short PT parental day is NOT inflated by the min-engagement floor', () => {
    // 2h contracted day for a part-timer: an as-worked pricing would floor it
    // to 3 paid hours (cl 12.3(e)); an absence day must pay the 2h flat.
    const r = computeShiftGrossPay(baseShift({
      isParentalLeave: true, employmentType: 'Part-Time',
      netMinutes: 120, scheduledLengthMinutes: 120,
    }));
    expect(r.paidHours).toBe(2);
    expect(r.grossPay).toBeCloseTo(2 * 30, 2);
  });
});

// ── buildLeaveInputs: dailyMinutesOverrides ─────────────────────────────────

describe('buildLeaveInputs — roster-aware daily minutes', () => {
  const req: LeaveRequestRow = {
    id: 'req-roster',
    employee_id: 'e1',
    leave_type: 'Annual Leave',
    start_date: '2026-07-06',
    end_date: '2026-07-08',
  };

  it('uses dailyMinutesOverrides when provided', () => {
    const overrides = new Map([
      ['2026-07-06', 600], // 10h shift
      ['2026-07-07', 480], // 8h shift
    ]);
    const days = ['2026-07-06', '2026-07-07', '2026-07-08'];
    const inputs = buildLeaveInputs(req, ftCtx, days, overrides);

    expect(inputs[0].netMinutes).toBe(600);
    expect(inputs[1].netMinutes).toBe(480);
    expect(inputs[2].netMinutes).toBe(ftCtx.dailyOrdinaryMinutes); // fallback
  });
});
