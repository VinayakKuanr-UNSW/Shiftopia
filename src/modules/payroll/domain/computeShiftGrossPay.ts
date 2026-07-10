/**
 * Per-shift gross pay — maps the EBA-compliant award breakdown into itemised
 * payslip earnings lines, priced from APPROVED ACTUAL worked hours.
 *
 * The award calculator is the single source of truth for the money; this file
 * only (a) adapts approved-hours input into its options, (b) short-circuits
 * unworked shifts to $0, and (c) decomposes its breakdown into earnings lines.
 * The decomposition is ENGINE-AWARE because the two engines report differently:
 *   • Standard: ordinaryCost already INCLUDES the weekend/PH penalty loading, and
 *     the night allowance is on breakdown.nightAllowanceCost (⊂ allowanceCost).
 *   • Security: ordinaryCost is the ordinary earnings at the paid rate and
 *     penaltyCost is the ADDITIVE weekend/PH term (no separate night allowance).
 */

import { estimateDetailedShiftCost } from '../../rosters/domain/projections/utils/cost/index';
import type { CostCalculatorOptions } from '../../rosters/domain/projections/utils/cost/types';
import type { EarningsLine, ShiftGrossPay, GrossPayHoursSource } from '../model/gross-pay.types';
import { ausHolidays } from '@/modules/core/lib/holidays';

function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
}

/** Approved-hours + rate context for one shift (populated by a read adapter). */
export interface GrossPayShiftInput {
  shiftId: string;
  employeeId: string;
  shiftDate: string;                 // YYYY-MM-DD

  // Approved worked hours (already manager-reviewed / adjusted).
  netMinutes: number;
  startTime?: string;                // 'HH:MM'
  endTime?: string;                  // 'HH:MM'
  isOvernight?: boolean;
  scheduledLengthMinutes?: number;
  hoursSource?: GrossPayHoursSource;

  // Not-worked / leave status.
  isCancelled?: boolean;
  isNoShow?: boolean;
  isAnnualLeave?: boolean;
  isPersonalLeave?: boolean;
  isCarerLeave?: boolean;
  isParentalLeave?: boolean;
  isLongServiceLeave?: boolean;
  isJuryDuty?: boolean;
  isSupportingCarer?: boolean;
  /**
   * cl 46 / NES Div 11 — family & domestic violence leave. Paid for ALL
   * employment types INCLUDING casuals (cl 46.6: paid for the hours rostered on
   * the day the leave is taken). PAYSLIP PRIVACY: the Fair Work Regulations
   * prohibit identifying FDV leave on a payslip, so this flag NEVER surfaces as
   * its own earnings code — it is reported as an ordinary 'personal_leave' line.
   */
  isFdvLeave?: boolean;
  /**
   * cl 56.4 / 44.8 — a public holiday the (permanent) member was not required to
   * work but would ordinarily have been rostered on (e.g. a PH inside an
   * approved leave range). Paid at the ordinary rate for the ordinary hours —
   * no loading, no penalties — and NOT a leave day (no balance consumption).
   */
  isPublicHolidayNotWorked?: boolean;

  // Rate context.
  rate: number | null;
  employmentType?: CostCalculatorOptions['employmentType'];
  classificationLevel?: string;
  isSecurityRole?: boolean;
  higherDutiesLevel?: string;
  allowances?: CostCalculatorOptions['allowances'];
  
  employeeName?: string;
  roleName?: string;
  groupName?: string;
  subGroupName?: string;

  // Weekly-OT sequencing (supplied by the period aggregator).
  priorOrdinaryHoursThisWeek?: number;
}

const NOT_WORKED = (input: GrossPayShiftInput): ShiftGrossPay => ({
  shiftId: input.shiftId,
  employeeId: input.employeeId,
  shiftDate: input.shiftDate,
  lines: [],
  grossPay: 0,
  ordinaryHours: 0,
  overtimeHours: 0,
  paidHours: 0,
  hoursSource: 'none',
  isLeave: false,
  employeeName: input.employeeName,
  roleName: input.roleName,
  groupName: input.groupName,
  subGroupName: input.subGroupName,
  startTime: input.startTime,
  endTime: input.endTime,
  employmentType: input.employmentType,
});

export function computeShiftGrossPay(input: GrossPayShiftInput): ShiftGrossPay {
  // A no-show (only decided AFTER a shift ends with no clock-in) or a cancelled
  // shift is not worked and is not paid.
  if (input.isNoShow || input.isCancelled) return NOT_WORKED(input);

  // A cl 56.4 not-worked public holiday is priced exactly like a personal-leave
  // day (ordinary base rate for the ordinary hours, casual ⇒ $0) but reported
  // under its own earnings code — it is NOT leave and consumes no leave balance.
  const isPhAbsence = !!input.isPublicHolidayNotWorked;
  // Parental (cl 51), LSL (cl 49 / LSL Act), jury make-up (cl 53) and supporting
  // carer (cl 52) are all paid at the FLAT ordinary base rate. They must route
  // through the engine's personal-leave path — if the engine priced them as
  // WORKED, weekend penalties, the min-engagement floor and weekly-OT
  // reclassification would all leak into an absence day.
  const isFlatAbsence = isPhAbsence
    || !!(input.isParentalLeave || input.isLongServiceLeave || input.isJuryDuty
        || input.isSupportingCarer);
  const isLeave = isFlatAbsence
    || !!(input.isAnnualLeave || input.isPersonalLeave || input.isCarerLeave || input.isFdvLeave);

  const opts: CostCalculatorOptions & { isSecurityRole?: boolean } = {
    netMinutes: input.netMinutes,
    start_time: input.startTime ?? '',
    end_time: input.endTime ?? '',
    rate: input.rate,
    scheduled_length_minutes: input.scheduledLengthMinutes ?? 0,
    is_overnight: !!input.isOvernight,
    is_cancelled: false,
    shift_date: input.shiftDate,
    employmentType: input.employmentType,
    classificationLevel: input.classificationLevel,
    isSecurityRole: input.isSecurityRole,
    allowances: input.allowances,
    isAnnualLeave: input.isAnnualLeave,
    isPersonalLeave: isFlatAbsence ? true : input.isPersonalLeave,
    isCarerLeave: input.isCarerLeave,
    // FDV routes on its OWN engine flag (never folded into isPersonalLeave):
    // the engine's casual-zero rule must not fire for FDV (cl 46.6 pays casuals
    // their rostered hours at the loaded rate).
    isFdvLeave: input.isFdvLeave,
    higherDutiesLevel: input.higherDutiesLevel,
    priorOrdinaryHoursThisWeek: input.priorOrdinaryHoursThisWeek,
  };

  const b = estimateDetailedShiftCost(opts);
  const lines: EarningsLine[] = [];

  if (isLeave) {
    // The engine returns leave pay as the ordinaryCost lump (annual leave already
    // carries the greater of the 17.5% loading or the shift's penalties).
    if (isPhAbsence) {
      lines.push({ code: 'public_holiday', description: 'Public holiday (not worked)', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else if (input.isAnnualLeave) {
      lines.push({ code: 'annual_leave', description: 'Annual leave', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else if (input.isParentalLeave) {
      lines.push({ code: 'parental_leave', description: 'Paid parental leave (cl 51)', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else if (input.isLongServiceLeave) {
      lines.push({ code: 'long_service_leave', description: 'Long service leave', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else if (input.isJuryDuty) {
      lines.push({ code: 'jury_duty', description: 'Jury/court attendance (cl 53)', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else if (input.isSupportingCarer) {
      lines.push({ code: 'supporting_carer', description: 'Supporting carer leave (cl 52)', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else {
      // Personal, carer AND FDV leave all land here. FDV MUST surface with the
      // 'personal_leave' code and this exact description: the Fair Work
      // Regulations (reg 3.47) PROHIBIT a payslip from identifying an amount as
      // family & domestic violence leave — the line must be indistinguishable
      // from an ordinary personal/carer's leave line.
      lines.push({ code: 'personal_leave', description: "Personal / carer's leave", hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    }
    const grossPay = round2(lines.reduce((s, l) => s + l.amount, 0));
    return {
      shiftId: input.shiftId, employeeId: input.employeeId, shiftDate: input.shiftDate,
      lines, grossPay, ordinaryHours: b.ordinaryHours || 0, overtimeHours: 0,
      paidHours: round2(b.ordinaryHours || 0), hoursSource: input.hoursSource ?? 'actual', isLeave: true,
      ordinaryRate: b.breakdown.ordinaryRate || 0,
      employeeName: input.employeeName,
      roleName: input.roleName,
      groupName: input.groupName,
      subGroupName: input.subGroupName,
      startTime: input.startTime,
      endTime: input.endTime,
      employmentType: input.employmentType,
    };
  }

  const baseRate = b.breakdown.baseRate || 0;
  const isCasual = b.breakdown.isCasual;
  const ordinaryRate = (input.isSecurityRole && !isCasual && baseRate > (b.breakdown.ordinaryRate || 0))
    ? baseRate
    : (b.breakdown.ordinaryRate || 0);

  // Base Rate (ordinary hours @ base rate)
  if ((b.ordinaryHours || 0) > 0) {
    lines.push({
      code: 'ordinary',
      description: `Base rate ($${ordinaryRate.toFixed(2)}/h)`,
      hours: b.ordinaryHours,
      amount: round2((b.ordinaryHours || 0) * ordinaryRate),
    });
  }

  // Casual Loading (25%)
  if (isCasual && (b.ordinaryHours || 0) > 0) {
    lines.push({
      code: 'ordinary',
      description: 'Casual loading (25%)',
      hours: b.ordinaryHours,
      amount: round2((b.ordinaryHours || 0) * ordinaryRate * 0.25),
    });
  }

  // Saturday / Sunday / Public Holiday Loadings
  const dateObj = new Date(input.shiftDate + 'T00:00:00');
  const dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getDay();
  const isHoliday = !!ausHolidays.isHoliday(input.shiftDate);

  let startMins = 0;
  let endMins = (b.ordinaryHours || 0) * 60;
  if (input.startTime) {
    const [sh, sm] = input.startTime.split(':').map(Number);
    startMins = sh * 60 + sm;
    endMins = startMins + (b.ordinaryHours || 0) * 60;
  }

  interface Seg { hours: number; day: number; isHoliday: boolean; }
  const segments: Seg[] = [];
  if (endMins <= 1440) {
    segments.push({ hours: b.ordinaryHours || 0, day: dayOfWeek, isHoliday });
  } else {
    const firstDayHours = (1440 - startMins) / 60;
    const secondDayHours = (b.ordinaryHours || 0) - firstDayHours;
    if (firstDayHours > 0) {
      segments.push({ hours: firstDayHours, day: dayOfWeek, isHoliday });
    }
    if (secondDayHours > 0) {
      const d = new Date(input.shiftDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      const nextDateStr = `${y}-${m}-${r}`;
      segments.push({
        hours: secondDayHours,
        day: (dayOfWeek + 1) % 7,
        isHoliday: !!ausHolidays.isHoliday(nextDateStr),
      });
    }
  }

  let satHours = 0;
  let sunHours = 0;
  let phHours = 0;
  for (const seg of segments) {
    if (seg.isHoliday) {
      phHours += seg.hours;
    } else if (seg.day === 6) {
      satHours += seg.hours;
    } else if (seg.day === 0) {
      sunHours += seg.hours;
    }
  }

  // Only apply loadings if there is actually penalty cost paid (e.g. not annualised)
  if (b.penaltyCost > 0 || (!input.isSecurityRole && (satHours > 0 || sunHours > 0 || phHours > 0))) {
    if (satHours > 0) {
      lines.push({
        code: 'penalty',
        description: 'Saturday loading (25%)',
        hours: satHours,
        amount: round2(satHours * ordinaryRate * 0.25),
      });
    }
    if (sunHours > 0) {
      lines.push({
        code: 'penalty',
        description: 'Sunday loading (50%)',
        hours: sunHours,
        amount: round2(sunHours * ordinaryRate * 0.5),
      });
    }
    if (phHours > 0) {
      lines.push({
        code: 'penalty',
        description: 'Public holiday loading (150%)',
        hours: phHours,
        amount: round2(phHours * ordinaryRate * 1.5),
      });
    }
  }

  // Overtime
  if ((b.overtimeCost || 0) > 0) {
    lines.push({
      code: 'overtime',
      description: 'Overtime',
      hours: b.overtimeHours,
      amount: round2(b.overtimeCost),
    });
  }

  // Night shift allowance
  const night = round2(b.breakdown.nightAllowanceCost || 0);
  if (night > 0) {
    lines.push({
      code: 'night_allowance',
      description: 'Night-shift allowance',
      hours: b.breakdown.nightHours,
      amount: night,
    });
  }

  // Allowances (other)
  const other = round2((b.allowanceCost || 0) - night);
  if (other > 0) {
    lines.push({
      code: 'other_allowance',
      description: 'Allowances',
      amount: other,
    });
  }

  const grossPay = round2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    shiftId: input.shiftId,
    employeeId: input.employeeId,
    shiftDate: input.shiftDate,
    lines,
    grossPay,
    ordinaryHours: b.ordinaryHours || 0,
    overtimeHours: b.overtimeHours || 0,
    paidHours: round2((b.ordinaryHours || 0) + (b.overtimeHours || 0)),
    hoursSource: input.hoursSource ?? 'actual',
    isLeave: false,
    ordinaryRate: b.breakdown.ordinaryRate || 0,
    employeeName: input.employeeName,
    roleName: input.roleName,
    groupName: input.groupName,
    subGroupName: input.subGroupName,
    startTime: input.startTime,
    endTime: input.endTime,
    employmentType: input.employmentType,
  };
}
