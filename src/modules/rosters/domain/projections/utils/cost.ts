/**
 * Cost estimation utilities.
 *
 * Centralises the labour-cost formula so every mode shows identical figures.
 * All functions are pure and free of floating-point surprises (values are
 * rounded to the nearest cent).
 */

import type { Shift } from '../../shift.entity';
import Holidays from 'date-holidays';

const hd = new Holidays('AU', 'NSW');

/** Fallback hourly rate when a shift has no remuneration_rate set */
const DEFAULT_RATE = 25;

const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

export interface ShiftCostBreakdown {
  baseCost: number;
  penaltyCost: number;
  overtimeCost: number;
  allowanceCost: number;
  leaveLoadingCost: number;
  totalCost: number;
}

// Wage Rates for Team Members other than Full-time Security Team Members
const WAGE_RATES = {
        trainee: { weekly: 948.47, hourly: 24.96, casual: 31.20 },
        level1: { weekly: 974.65, hourly: 25.65, casual: 32.06 },
        level2: { weekly: 1001.95, hourly: 26.37, casual: 32.96 },
        level3: { weekly: 1034.89, hourly: 27.23, casual: 34.04 },
        level4: { weekly: 1094.18, hourly: 28.79, casual: 35.99 },
        level5: { weekly: 1171.14, hourly: 30.82, casual: 38.52 },
        level6: { weekly: 1247.31, hourly: 32.82, casual: 41.03 },
        level7: { weekly: 1299.27, hourly: 34.19, casual: 42.74 },
  };

// Standard ordinary-hours cap per shift
const ORDINARY_HOURS_CAP = 7.5;
 
// Hours of time-and-half overtime before double-time 
const TIME_AND_HALF_HOURS_CAP = 3;

// Multiplier for the first band of overtime
const TIME_AND_QUARTER_MULTIPLIER = 1.25;
 
// Multiplier for the first band of overtime
const TIME_AND_HALF_MULTIPLIER = 1.5;
 
// Multiplier for the first band of overtime
const TIME_AND_THREE_QUARTERS_MULTIPLIER = 1.75;
 
// Multiplier for overtime beyond the first band
const DOUBLE_TIME_MULTIPLIER = 2.0;

// Multiplier for overtime beyond the first band
const DOUBLE_TIME_AND_HALF_MULTIPLIER = 2.5;

// Multiplier for overtime beyond the first band
const DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER = 2.75;

// Casual loading factor applied on top of the ordinary rate
const CASUAL_LOADING = 1.25;
 
// Annual leave loading applied on top of ordinary pay
const ANNUAL_LEAVE_LOADING = 1.175;
 
// Additional loadings
const ADDITIONAL_LOADING1 = 1.2;
const ADDITIONAL_LOADING2 = 1.45;

const ALLOWANCE_MEAL = 13.61;
const ALLOWANCE_FIRST_AID_PER_HOUR = 0.56;
const ALLOWANCE_PROTEIN_SPILL = 7.17;
const ALLOWANCE_SPLIT_SHIFT = 11.13;
 
// Minimum overtime hours before the meal allowance is triggered
const MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS = 2;
 
// Adult-apprentice wage rates 
const ADULT_APPRENTICE_YEAR1_RATE = 0.8 * WAGE_RATES.level4.hourly;
const ADULT_APPRENTICE_SUBSEQUENT_YEARS_RATE = 0.8;

// Percentage of the Level 4 rate for each apprentice year when the apprentice HAS NOT completed Year 12.
const APPRENTICE_RATES_NO_YEAR12: Record<1 | 2 | 3 | 4, number> = {
  1: 0.50,
  2: 0.60,
  3: 0.75,
  4: 0.95,
};
 
// Percentage of the Level 4 rate for each apprentice year when the apprentice HAS completed Year 12.
const APPRENTICE_RATES_YEAR12: Record<1 | 2 | 3 | 4, number> = {
  1: 0.55,
  2: 0.65,
  3: 0.75,
  4: 0.95,
};

function isPermanent(rate: number): boolean {
    for (const [level, rates] of Object.entries(WAGE_RATES)) {
        if (rates.hourly === rate) {
            return true;
        }
    }
    return false;
}

function calcPublicHolidayRate(rate: number): number {
  if (isPermanent(rate)) {
     // 250% 
    return rate * DOUBLE_TIME_AND_HALF_MULTIPLIER;
  }
   // 275%
  return rate * DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER;
}

function calcNightShiftRate(rate: number, shiftDay: number): number {
  // Shift ends on next day
  const endDay = (shiftDay + 1) % 7;
  
  if (isPermanent(rate)) {
    return calcPermanentNightShiftRate(rate, endDay);
  }
  return calcCasualNightShiftRate(rate, endDay);
}

function calcPermanentNightShiftRate(rate: number, endDay: number): number {
  if (endDay === MONDAY || endDay === TUESDAY || endDay === WEDNESDAY || endDay === THURSDAY) {
    // 20% loading
    return rate * ADDITIONAL_LOADING1;
  }
  if (endDay === FRIDAY) {
    // 25% loading
    return rate * TIME_AND_QUARTER_MULTIPLIER;
  }
  // 50% loading on Sat/Sun
  return rate * TIME_AND_HALF_MULTIPLIER;
}

function calcCasualNightShiftRate(rate: number, endDay: number): number {
  if (endDay === MONDAY || endDay === TUESDAY || endDay === WEDNESDAY || endDay === THURSDAY) {
    // 45% loading
    return rate * ADDITIONAL_LOADING2;
  }
  if (endDay === FRIDAY) {
    // 50% loading
    return rate * TIME_AND_HALF_MULTIPLIER;
  }
  // 75% loading on Sat/Sun
  return rate * TIME_AND_THREE_QUARTERS_MULTIPLIER;
}

function calcSaturdayRate(rate: number): number {
  if (isPermanent(rate)) {
    // 25% loading
    return rate * TIME_AND_QUARTER_MULTIPLIER; 
  }
  // 50% loading
  return rate * TIME_AND_HALF_MULTIPLIER; 
}
function calcSundayRate(rate: number): number {
  if (isPermanent(rate)) {
    // 50% loading
    return rate * TIME_AND_HALF_MULTIPLIER;
  }
  // 75% loading
  return rate * TIME_AND_THREE_QUARTERS_MULTIPLIER;
}

function calcPenaltyRate(rate: number, shift_date: string, is_overnight: boolean): number {
  const shiftDate = new Date(shift_date);
  const shiftDay = shiftDate.getDay();
  
  const isPublicHoliday = hd.isHoliday(shift_date);
  if (isPublicHoliday) {
    return calcPublicHolidayRate(rate);
  }
  
  if (is_overnight) {
    return calcNightShiftRate(rate, shiftDay);
  }
  
  if (shiftDay === SATURDAY) {
    return calcSaturdayRate(rate);
  }
  
  if (shiftDay === SUNDAY) {
    return calcSundayRate(rate);
  }
  
  return rate;
}

function calcPenaltyCost(ordinaryHours: number, effectiveRate: number, penaltyRate: number): number {
  return ordinaryHours * (penaltyRate - effectiveRate);
}

function toOrdinaryRate(casualRate: number): number {
  return Math.round((casualRate / CASUAL_LOADING) * 100) / 100;
}

function calcOrdinaryCost(ordinaryHours: number, ordinaryRate: number): number {
  return ordinaryHours * ordinaryRate;
}
 
// First 3 hours are time-and-half, additional hours are double-time
// Applied to ordinary rate — casual loading is absorbed.
function calcOvertimeCost(overtimeHours: number, ordinaryRate: number): number {
  if (overtimeHours === 0) return 0;
  const time_and_half_hours = Math.min(overtimeHours, TIME_AND_HALF_HOURS_CAP);
  const double_time_hours = Math.max(0, overtimeHours - TIME_AND_HALF_HOURS_CAP);
  return time_and_half_hours * TIME_AND_HALF_MULTIPLIER * ordinaryRate
       + double_time_hours * DOUBLE_TIME_MULTIPLIER * ordinaryRate;
}

function calcAllowanceCost(ordinaryHours: number, overtimeHours: number, allowances: NonNullable<Shift['allowances']>,
): number {
  let total = 0;
 
  if (allowances.meal && overtimeHours > MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS) {
    total += ALLOWANCE_MEAL;
  }
  if (allowances.firstAid) {
    total += ALLOWANCE_FIRST_AID_PER_HOUR * ordinaryHours;
  }
  if (allowances.proteinSpill) {
    total += ALLOWANCE_PROTEIN_SPILL;
  }
  if (allowances.splitShift) {
    total += ALLOWANCE_SPLIT_SHIFT;
  }
  return total;
}
 
function calcAnnualLeaveLoading(ordinaryCost: number): number {
  return ordinaryCost * (ANNUAL_LEAVE_LOADING - 1);
}

/**
 * Estimate the labour cost of a single shift.
 *
 * @param netMinutes  Shift net duration in minutes (after breaks).
 * @param rate        Hourly rate in the shift's currency.  Pass null to fall
 *                    back to DEFAULT_RATE (25).
 */
export function estimateShiftCost(netMinutes: number, start_time: string, end_time: string, rate: number | null, 
  scheduled_length_minutes: number, is_overnight: boolean, is_cancelled: boolean, shift_date: string, 
  allowances?: {
    meal?: boolean;
    firstAid?: boolean;
    proteinSpill?: boolean;
    splitShift?: boolean;
  },
  isAnnualLeave?: boolean, isPersonalLeave?: boolean, isCarerLeave?: boolean, previousWage?: number,
): number {
  let effectiveRate = rate ?? DEFAULT_RATE;
  let ordinaryRate = effectiveRate
  if (!isPermanent(effectiveRate)) {
    ordinaryRate = toOrdinaryRate(effectiveRate);
  }

  if (previousWage != null && previousWage > effectiveRate) {
    effectiveRate = previousWage;
  }

  const penaltyRate = calcPenaltyRate(effectiveRate, shift_date, is_overnight);

  const netHours = netMinutes / 60;
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP);
  const overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP);

  const ordinaryCost = calcOrdinaryCost(ordinaryHours, effectiveRate);
  const penaltyCost = calcPenaltyCost(ordinaryHours, effectiveRate, penaltyRate);
  const overtimeCost = calcOvertimeCost(overtimeHours, ordinaryRate);

  let allowanceCost = 0;
  let annualLeaveCost = 0;
  if (allowances != null) {
    allowanceCost = calcAllowanceCost(ordinaryHours, overtimeHours, allowances);
  }

  if (isAnnualLeave != null) {
    annualLeaveCost = calcAnnualLeaveLoading(ordinaryCost);
  }

  const total = Math.round((ordinaryCost + penaltyCost + overtimeCost + allowanceCost + annualLeaveCost) * 100) / 100;
  return total;
}

/**
 * Detailed version of estimateShiftCost.
 */
export function estimateDetailedShiftCost(
  netMinutes: number,
  start_time: string,
  end_time: string,
  rate: number | null,
  scheduled_length_minutes: number,
  is_overnight: boolean,
  is_cancelled: boolean,
  shift_date: string,
  allowances?: {
    meal?: boolean;
    firstAid?: boolean;
    proteinSpill?: boolean;
    splitShift?: boolean;
  },
  isAnnualLeave?: boolean,
  isPersonalLeave?: boolean,
  isCarerLeave?: boolean,
  previousWage?: number
): ShiftCostBreakdown {
  let effectiveRate = rate ?? DEFAULT_RATE;
  let ordinaryRate = effectiveRate;
  if (!isPermanent(effectiveRate)) {
    ordinaryRate = toOrdinaryRate(effectiveRate);
  }

  if (previousWage != null && previousWage > effectiveRate) {
    effectiveRate = previousWage;
  }

  const penaltyRate = calcPenaltyRate(effectiveRate, shift_date, is_overnight);

  const netHours = netMinutes / 60;
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP);
  const overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP);

  const ordinaryCost = calcOrdinaryCost(ordinaryHours, effectiveRate);
  const penaltyCost = calcPenaltyCost(ordinaryHours, effectiveRate, penaltyRate);
  const overtimeCost = calcOvertimeCost(overtimeHours, ordinaryRate);

  let allowanceCost = 0;
  let annualLeaveCost = 0;
  if (allowances != null) {
    allowanceCost = calcAllowanceCost(ordinaryHours, overtimeHours, allowances);
  }

  if (isAnnualLeave != null) {
    annualLeaveCost = calcAnnualLeaveLoading(ordinaryCost);
  }

  const total = ordinaryCost + penaltyCost + overtimeCost + allowanceCost + annualLeaveCost;

  return {
    baseCost: Math.round(ordinaryCost * 100) / 100,
    penaltyCost: Math.round(penaltyCost * 100) / 100,
    overtimeCost: Math.round(overtimeCost * 100) / 100,
    allowanceCost: Math.round(allowanceCost * 100) / 100,
    leaveLoadingCost: Math.round(annualLeaveCost * 100) / 100,
    totalCost: Math.round(total * 100) / 100,
  };
}

/**
 * Estimate cost directly from a Shift entity.
 * Convenience wrapper around estimateShiftCost.
 */
export function estimateCostFromShift(
  shift: Pick<Shift, 'net_length_minutes' | 'start_time' | 'end_time' | 'unpaid_break_minutes' | 'remuneration_rate' | 
  'scheduled_length_minutes' | 'is_overnight' | 'is_cancelled' | 'shift_date' | 'allowances' | 'isAnnualLeave' |
  'isPersonalLeave' | 'isCarerLeave' | 'previousWage'>,

  netMinutesOverride?: number,
): number {
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? 0;
  return estimateShiftCost(mins, shift.start_time, shift.end_time, shift.remuneration_rate, shift.scheduled_length_minutes, 
    shift.is_overnight, shift.is_cancelled, shift.shift_date, shift.allowances, shift.isAnnualLeave, shift.isPersonalLeave,
  shift.isCarerLeave, shift.previousWage);
}

/**
 * Detailed version of estimateCostFromShift.
 */
export function estimateDetailedCostFromShift(
  shift: Pick<Shift, 'net_length_minutes' | 'start_time' | 'end_time' | 'unpaid_break_minutes' | 'remuneration_rate' | 
  'scheduled_length_minutes' | 'is_overnight' | 'is_cancelled' | 'shift_date' | 'allowances' | 'isAnnualLeave' |
  'isPersonalLeave' | 'isCarerLeave' | 'previousWage'>,
  netMinutesOverride?: number,
): ShiftCostBreakdown {
  const mins = netMinutesOverride ?? shift.net_length_minutes ?? 0;
  return estimateDetailedShiftCost(mins, shift.start_time, shift.end_time, shift.remuneration_rate, shift.scheduled_length_minutes, 
    shift.is_overnight, shift.is_cancelled, shift.shift_date, shift.allowances, shift.isAnnualLeave, shift.isPersonalLeave,
  shift.isCarerLeave, shift.previousWage);
}

/**
 * Format a cost value as a localised currency string.
 * e.g. 1234.5 → "$1,234.50" (AUD-style)
 */
export function formatCost(amount: number, currency = 'AUD'): string {
  return amount.toLocaleString('en-AU', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  });
}
