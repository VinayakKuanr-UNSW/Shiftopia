/**
 * Gross-pay engine — payslip-grade earnings model.
 *
 * This layer sits ON TOP of the EBA-compliant award calculator
 * (src/modules/rosters/domain/projections/utils/cost). That calculator prices
 * ONE shift's award cost from hours + rate context; this module feeds it
 * APPROVED ACTUAL worked hours (not scheduled) and aggregates the result per
 * employee per pay period into itemised gross-earnings lines that are
 * payslip-ready.
 *
 * SCOPE BOUNDARY — this is GROSS pay only. PAYG withholding, superannuation
 * guarantee, STP (Single Touch Payroll) reporting and net-pay disbursement are
 * deliberately OUT of scope and should be handed to a certified payroll
 * provider. `PeriodGrossPay` is the hand-off record for that provider.
 */

/** Payslip earnings-line categories (payslip-group granularity). */
export type EarningsCode =
  | 'ordinary'          // ordinary-time hours at the ordinary rate
  | 'penalty'           // weekend / public-holiday loading (cl 41)
  | 'overtime'          // cl 42 (daily + weekly + PH overtime)
  | 'night_allowance'   // cl 43 night-shift allowance
  | 'other_allowance'   // meal / first-aid / protein-spill / split-shift (cl 28)
  | 'annual_leave'      // paid annual leave (incl. 17.5% loading, cl 38)
  | 'personal_leave'    // paid personal / carer's leave (NES ss96–99)
  | 'leave_loading';    // reserved: explicit 17.5% split if ever itemised separately

export interface EarningsLine {
  code: EarningsCode;
  description: string;
  /** Present for time-based lines; omitted for per-shift/lump lines. */
  hours?: number;
  /** Dollars, rounded to whole cents. */
  amount: number;
}

/**
 * Provenance of the hours that were priced. `actual` = the shift was worked and
 * priced from manager-approved actual/adjusted times; `none` = not worked
 * (no-show / cancelled) and therefore not paid.
 */
export type GrossPayHoursSource = 'actual' | 'adjusted' | 'scheduled_fallback' | 'none';

/** Gross pay for a single shift, itemised into earnings lines. */
export interface ShiftGrossPay {
  shiftId: string;
  employeeId: string;
  shiftDate: string;            // YYYY-MM-DD
  lines: EarningsLine[];
  grossPay: number;             // = sum(lines.amount), rounded to cents
  ordinaryHours: number;        // paid ordinary hours (post weekly-OT reclass)
  overtimeHours: number;        // paid overtime hours
  paidHours: number;            // ordinary + overtime (0 for no-show / cancelled)
  hoursSource: GrossPayHoursSource;
  isLeave: boolean;
}

/** One gross-pay record per employee per pay period (the payroll hand-off). */
export interface PeriodGrossPay {
  employeeId: string;
  periodId?: string;
  periodStart: string;          // YYYY-MM-DD, inclusive
  periodEnd: string;            // YYYY-MM-DD, inclusive
  shifts: ShiftGrossPay[];
  lines: EarningsLine[];        // aggregated by code, in canonical order
  grossPay: number;
  paidHours: number;
  shiftCount: number;
}
