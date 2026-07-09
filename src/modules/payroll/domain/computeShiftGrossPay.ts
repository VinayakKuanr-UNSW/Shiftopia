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

  // Rate context.
  rate: number | null;
  employmentType?: CostCalculatorOptions['employmentType'];
  classificationLevel?: string;
  isSecurityRole?: boolean;
  higherDutiesLevel?: string;
  allowances?: CostCalculatorOptions['allowances'];

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
});

export function computeShiftGrossPay(input: GrossPayShiftInput): ShiftGrossPay {
  // A no-show (only decided AFTER a shift ends with no clock-in) or a cancelled
  // shift is not worked and is not paid.
  if (input.isNoShow || input.isCancelled) return NOT_WORKED(input);

  const isLeave = !!(input.isAnnualLeave || input.isPersonalLeave || input.isCarerLeave);

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
    isPersonalLeave: input.isPersonalLeave,
    isCarerLeave: input.isCarerLeave,
    higherDutiesLevel: input.higherDutiesLevel,
    priorOrdinaryHoursThisWeek: input.priorOrdinaryHoursThisWeek,
  };

  const b = estimateDetailedShiftCost(opts);
  const isSecurity = !!input.isSecurityRole;
  const lines: EarningsLine[] = [];

  if (isLeave) {
    // The engine returns leave pay as the ordinaryCost lump (annual leave already
    // carries the greater of the 17.5% loading or the shift's penalties).
    if (input.isAnnualLeave) {
      lines.push({ code: 'annual_leave', description: 'Annual leave', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    } else {
      lines.push({ code: 'personal_leave', description: "Personal / carer's leave", hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    }
    const grossPay = round2(lines.reduce((s, l) => s + l.amount, 0));
    return {
      shiftId: input.shiftId, employeeId: input.employeeId, shiftDate: input.shiftDate,
      lines, grossPay, ordinaryHours: b.ordinaryHours || 0, overtimeHours: 0,
      paidHours: round2(b.ordinaryHours || 0), hoursSource: input.hoursSource ?? 'actual', isLeave: true,
    };
  }

  const ordinaryRate = b.breakdown.ordinaryRate || 0;

  if (isSecurity) {
    // Security: ordinaryCost is the ordinary earnings; penaltyCost is additive.
    if ((b.ordinaryCost || 0) > 0) lines.push({ code: 'ordinary', description: 'Ordinary hours', hours: b.ordinaryHours, amount: round2(b.ordinaryCost) });
    if ((b.penaltyCost || 0) > 0) lines.push({ code: 'penalty', description: 'Weekend / public-holiday penalty', amount: round2(b.penaltyCost) });
    if ((b.overtimeCost || 0) > 0) lines.push({ code: 'overtime', description: 'Overtime', hours: b.overtimeHours, amount: round2(b.overtimeCost) });
  } else {
    // Standard: split ordinaryCost into base ordinary vs weekend/PH penalty.
    const ordinaryBase = round2((b.ordinaryHours || 0) * ordinaryRate);
    if (ordinaryBase !== 0) lines.push({ code: 'ordinary', description: 'Ordinary hours', hours: b.ordinaryHours, amount: ordinaryBase });

    const penalty = round2((b.ordinaryCost || 0) - ordinaryBase);
    if (penalty > 0) lines.push({ code: 'penalty', description: 'Weekend / public-holiday penalty', amount: penalty });

    if ((b.overtimeCost || 0) > 0) lines.push({ code: 'overtime', description: 'Overtime', hours: b.overtimeHours, amount: round2(b.overtimeCost) });

    const night = round2(b.breakdown.nightAllowanceCost || 0);
    if (night > 0) lines.push({ code: 'night_allowance', description: 'Night-shift allowance', hours: b.breakdown.nightHours, amount: night });

    const other = round2((b.allowanceCost || 0) - night);
    if (other > 0) lines.push({ code: 'other_allowance', description: 'Allowances', amount: other });
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
  };
}
