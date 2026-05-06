
import { 
  hd, SUNDAY, SATURDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY,
  TIME_AND_QUARTER_MULTIPLIER, TIME_AND_HALF_MULTIPLIER, TIME_AND_THREE_QUARTERS_MULTIPLIER,
  DOUBLE_TIME_MULTIPLIER, DOUBLE_TIME_AND_HALF_MULTIPLIER, DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER,
  CASUAL_LOADING, ANNUAL_LEAVE_LOADING, ADDITIONAL_LOADING1, ADDITIONAL_LOADING2,
  ALLOWANCE_MEAL, ALLOWANCE_FIRST_AID_PER_HOUR, ALLOWANCE_PROTEIN_SPILL, ALLOWANCE_SPLIT_SHIFT,
  MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS, TIME_AND_HALF_HOURS_CAP, DEFAULT_RATE
} from './constants';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';

const WAGE_RATES = {
  trainee: { hourly: 24.96 },
  level1:  { hourly: 25.65 },
  level2:  { hourly: 26.37 },
  level3:  { hourly: 27.23 },
  level4:  { hourly: 28.79 },
  level5:  { hourly: 30.82 },
  level6:  { hourly: 32.82 },
  level7:  { hourly: 34.19 },
};

const ORDINARY_HOURS_CAP_STANDARD = 7.6;

function isPermanentRate(rate: number): boolean {
  return Object.values(WAGE_RATES).some(r => r.hourly === rate);
}

function toOrdinaryRate(casualRate: number): number {
  return Math.round((casualRate / CASUAL_LOADING) * 100) / 100;
}

function calcPenaltyRate(ordinaryRate: number, isCasual: boolean, shift_date: string, is_overnight: boolean): number {
  const shiftDate = new Date(shift_date);
  const shiftDay = shiftDate.getDay();
  
  if (hd.isHoliday(shift_date)) {
    return isCasual ? ordinaryRate * DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * DOUBLE_TIME_AND_HALF_MULTIPLIER;
  }
  
  if (is_overnight) {
    const endDay = (shiftDay + 1) % 7;
    const isSatSun = endDay === SATURDAY || endDay === SUNDAY;
    const isFri = endDay === FRIDAY;
    
    if (!isCasual) {
      if (isSatSun) return ordinaryRate * TIME_AND_HALF_MULTIPLIER;
      if (isFri) return ordinaryRate * TIME_AND_QUARTER_MULTIPLIER;
      return ordinaryRate * ADDITIONAL_LOADING1;
    } else {
      if (isSatSun) return ordinaryRate * TIME_AND_THREE_QUARTERS_MULTIPLIER;
      if (isFri) return ordinaryRate * TIME_AND_HALF_MULTIPLIER;
      return ordinaryRate * ADDITIONAL_LOADING2;
    }
  }
  
  if (shiftDay === SATURDAY) {
    return isCasual ? ordinaryRate * TIME_AND_HALF_MULTIPLIER : ordinaryRate * TIME_AND_QUARTER_MULTIPLIER;
  }
  if (shiftDay === SUNDAY) {
    return isCasual ? ordinaryRate * TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * TIME_AND_HALF_MULTIPLIER;
  }
  
  return ordinaryRate;
}

export function estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown {
  const { netMinutes, rate, shift_date, is_overnight, allowances, isAnnualLeave, previousWage, employmentType } = options;
  let effectiveRate = rate ?? DEFAULT_RATE;
  
  const isCasual = employmentType === 'Casual' || !isPermanentRate(effectiveRate);
  const ordinaryRate = isCasual ? toOrdinaryRate(effectiveRate) : effectiveRate;
  
  const finalEffectiveRate = (previousWage != null && previousWage > effectiveRate) ? previousWage : effectiveRate;

  const penaltyRate = calcPenaltyRate(ordinaryRate, isCasual, shift_date, is_overnight);
  const netHours = netMinutes / 60;
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP_STANDARD);
  const overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP_STANDARD);

  const ordinaryCost = ordinaryHours * finalEffectiveRate;
  const penaltyCost = ordinaryHours * Math.max(0, penaltyRate - finalEffectiveRate);
  
  const ot_th = Math.min(overtimeHours, TIME_AND_HALF_HOURS_CAP);
  const ot_dt = Math.max(0, overtimeHours - TIME_AND_HALF_HOURS_CAP);
  const overtimeCost = (ot_th * TIME_AND_HALF_MULTIPLIER + ot_dt * DOUBLE_TIME_MULTIPLIER) * ordinaryRate;

  let allowanceCost = 0;
  if (allowances) {
    if (allowances.meal && overtimeHours > MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS) allowanceCost += ALLOWANCE_MEAL;
    if (allowances.firstAid) allowanceCost += ALLOWANCE_FIRST_AID_PER_HOUR * ordinaryHours;
    if (allowances.proteinSpill) allowanceCost += ALLOWANCE_PROTEIN_SPILL;
    if (allowances.splitShift) allowanceCost += ALLOWANCE_SPLIT_SHIFT;
  }

  const annualLeaveCost = isAnnualLeave ? ordinaryCost * (ANNUAL_LEAVE_LOADING - 1) : 0;
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

export function estimateShiftCost(options: CostCalculatorOptions): number {
  return estimateDetailedShiftCost(options).totalCost;
}
