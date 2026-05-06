
import { 
  hd, SUNDAY, SATURDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY,
  TIME_AND_QUARTER_MULTIPLIER, TIME_AND_HALF_MULTIPLIER, TIME_AND_THREE_QUARTERS_MULTIPLIER,
  DOUBLE_TIME_MULTIPLIER, DOUBLE_TIME_AND_HALF_MULTIPLIER, DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER,
  CASUAL_LOADING, ANNUAL_LEAVE_LOADING, ADDITIONAL_LOADING1, ADDITIONAL_LOADING2,
  ALLOWANCE_MEAL, ALLOWANCE_FIRST_AID_PER_HOUR, ALLOWANCE_PROTEIN_SPILL, ALLOWANCE_SPLIT_SHIFT,
  MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS, TIME_AND_HALF_HOURS_CAP, DEFAULT_RATE
} from './constants';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';

/**
 * SECURITY COST ENGINE (Building Services)
 * 
 * Implements specific rules for Security Team Members under the ICC Sydney EA.
 */

const SECURITY_ANNUALISED_RATES = {
  level3: 32.20,
  level4: 34.63,
  level5: 37.06,
  level6: 39.48,
};

const SECURITY_ORDINARY_MAPPING: Record<number, number> = {
  32.20: 27.23, // Level 3
  34.63: 28.79, // Level 4
  37.06: 30.82, // Level 5
  39.48: 32.82, // Level 6
};

const ORDINARY_HOURS_CAP_SECURITY = 12.0;

function isSecurityAnnualised(rate: number): boolean {
  return Object.values(SECURITY_ANNUALISED_RATES).includes(rate);
}

function toOrdinaryRate(casualRate: number): number {
  return Math.round((casualRate / CASUAL_LOADING) * 100) / 100;
}

export function estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown {
  const { netMinutes, rate, shift_date, is_overnight, allowances, isAnnualLeave, previousWage, employmentType } = options;
  let effectiveRate = rate ?? DEFAULT_RATE;
  
  const isAnnualised = isSecurityAnnualised(effectiveRate);
  const isCasual = !isAnnualised && employmentType === 'Casual';
  
  let ordinaryRate = effectiveRate;
  if (isAnnualised) {
    ordinaryRate = SECURITY_ORDINARY_MAPPING[effectiveRate] ?? effectiveRate;
  } else if (isCasual) {
    ordinaryRate = toOrdinaryRate(effectiveRate);
  }

  const finalEffectiveRate = (previousWage != null && previousWage > effectiveRate) ? previousWage : effectiveRate;

  let penaltyRate = finalEffectiveRate;
  if (!isAnnualised) {
    const shiftDay = new Date(shift_date).getDay();
    if (hd.isHoliday(shift_date)) {
      penaltyRate = isCasual ? ordinaryRate * DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * DOUBLE_TIME_AND_HALF_MULTIPLIER;
    } else if (shiftDay === SATURDAY) {
      penaltyRate = isCasual ? ordinaryRate * TIME_AND_HALF_MULTIPLIER : ordinaryRate * TIME_AND_QUARTER_MULTIPLIER;
    } else if (shiftDay === SUNDAY) {
      penaltyRate = isCasual ? ordinaryRate * TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * TIME_AND_HALF_MULTIPLIER;
    }
  }

  const netHours = netMinutes / 60;
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP_SECURITY);
  const overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP_SECURITY);

  const ordinaryCost = ordinaryHours * finalEffectiveRate;
  const penaltyCost = ordinaryHours * Math.max(0, penaltyRate - finalEffectiveRate);
  
  const ot_th = Math.min(overtimeHours, TIME_AND_HALF_HOURS_CAP);
  const ot_dt = Math.max(0, overtimeHours - TIME_AND_HALF_HOURS_CAP);
  const overtimeCost = (ot_th * TIME_AND_HALF_MULTIPLIER + ot_dt * DOUBLE_TIME_MULTIPLIER) * ordinaryRate;

  const total = ordinaryCost + penaltyCost + overtimeCost;

  return {
    totalCost: Math.round(total * 100) / 100,
    ordinaryCost: Math.round(ordinaryCost * 100) / 100,
    overtimeCost: Math.round(overtimeCost * 100) / 100,
    penaltyCost: Math.round(penaltyCost * 100) / 100,
    ordinaryHours,
    overtimeHours,
    breakdown: {
      baseRate: finalEffectiveRate,
      ordinaryRate,
      penaltyRate,
      isCasual,
      isApprentice: false,
      isTrainee: false
    }
  };
}

export function estimateShiftCost(options: CostCalculatorOptions): number {
  return estimateDetailedShiftCost(options).totalCost;
}
