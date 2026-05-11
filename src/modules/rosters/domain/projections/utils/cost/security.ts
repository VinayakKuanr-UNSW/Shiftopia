import { 
  hd, SATURDAY, SUNDAY, DEFAULT_RATE, CASUAL_LOADING, TIME_AND_HALF_MULTIPLIER, TIME_AND_QUARTER_MULTIPLIER, TIME_AND_THREE_QUARTERS_MULTIPLIER, DOUBLE_TIME_AND_HALF_MULTIPLIER, DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER, TIME_AND_HALF_HOURS_CAP, DOUBLE_TIME_MULTIPLIER
} from './constants';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import type { AwardContext } from './award-context';
import { getDateFacts, parseTimeToMinutes } from './award-context';

/**
 * SECURITY COST ENGINE (Building Services)
 * 
 * Performance:
 *   - Uses mandatory AwardContext for O(1) date lookups.
 *   - Uses pure integer arithmetic for all time calculations.
 *   - ZERO allocations in the hot loop.
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

export function estimateDetailedShiftCost(
  options: CostCalculatorOptions,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  const { netMinutes, rate, shift_date, is_overnight, previousWage, employmentType } = options;
  let effectiveRate = rate ?? DEFAULT_RATE;
  if (isNaN(effectiveRate)) effectiveRate = DEFAULT_RATE;
  
  const isAnnualised = isSecurityAnnualised(effectiveRate);
  const isCasual = !isAnnualised && /casual/i.test(employmentType || '');
  
  let ordinaryRate = effectiveRate;
  if (isAnnualised) {
    ordinaryRate = SECURITY_ORDINARY_MAPPING[effectiveRate] ?? effectiveRate;
  } else if (isCasual) {
    ordinaryRate = toOrdinaryRate(effectiveRate);
  }
  if (isNaN(ordinaryRate)) ordinaryRate = effectiveRate;

  const finalEffectiveRate = (previousWage != null && previousWage > effectiveRate) ? previousWage : effectiveRate;

  // ── Date facts (Phase 3) ───────────────────────────────────────────────
  let isHoliday: boolean;
  let shiftDay: number;

  if (ctx) {
    const facts = getDateFacts(ctx, shift_date);
    isHoliday = facts.isPublicHoliday;
    shiftDay = facts.dayOfWeek;
  } else {
    isHoliday = !!hd.isHoliday(shift_date);
    shiftDay = new Date(shift_date + 'T00:00:00').getDay();
  }

  let penaltyRate = finalEffectiveRate;

  if (!isAnnualised) {
    if (isHoliday) {
      penaltyRate = isCasual ? ordinaryRate * DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * DOUBLE_TIME_AND_HALF_MULTIPLIER;
    } else if (shiftDay === SATURDAY) {
      penaltyRate = isCasual ? ordinaryRate * TIME_AND_HALF_MULTIPLIER : ordinaryRate * TIME_AND_QUARTER_MULTIPLIER;
    } else if (shiftDay === SUNDAY) {
      penaltyRate = isCasual ? ordinaryRate * TIME_AND_THREE_QUARTERS_MULTIPLIER : ordinaryRate * TIME_AND_HALF_MULTIPLIER;
    }
  }

  // Schedule 3: Paid Meal Breaks and Minimum Engagement
  let calculatedMinutes = netMinutes;
  if (options.start_time && options.end_time) {
    // Fast path: integer arithmetic
    const startMins = parseTimeToMinutes(String(options.start_time).substring(0, 5));
    let endMins = parseTimeToMinutes(String(options.end_time).substring(0, 5));
    if (is_overnight || endMins <= startMins) endMins += 1440;
    // For Security, the meal break is PAID — use full span
    calculatedMinutes = endMins - startMins;
  }

  // Clause 5.3(e): Minimum Engagement
  // 4 hours for Sunday or Public Holiday, 3 hours otherwise.
  const minEngagementMinutes = (isHoliday || shiftDay === SUNDAY) ? 240 : 180;
  const finalMinutes = Math.max(calculatedMinutes, minEngagementMinutes);

  const netHours = finalMinutes / 60;
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

export function estimateShiftCost(options: CostCalculatorOptions, ctx?: AwardContext): number {
  return estimateDetailedShiftCost(options, ctx).totalCost;
}
