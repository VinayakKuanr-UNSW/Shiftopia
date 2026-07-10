/**
 * Payroll — GROSS-pay engine (public surface).
 *
 * Prices approved actual worked hours through the EBA-compliant award
 * calculator and rolls it up per employee per pay period into itemised gross
 * earnings. GROSS only — tax / super / STP / disbursement are out of scope and
 * belong to a certified payroll provider (see model/gross-pay.types.ts).
 */
export type {
  EarningsCode,
  EarningsLine,
  ShiftGrossPay,
  PeriodGrossPay,
  GrossPayHoursSource,
} from './model/gross-pay.types';

export { computeShiftGrossPay, type GrossPayShiftInput } from './domain/computeShiftGrossPay';
export {
  aggregatePeriodGrossPay,
  computeEmployeePeriodGrossPay,
  isoWeekKey,
  type PeriodBounds,
  type PeriodConfig,
} from './domain/aggregatePeriodGrossPay';
