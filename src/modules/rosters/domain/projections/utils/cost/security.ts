import {
  hd, SATURDAY, SUNDAY, CASUAL_LOADING, TIME_AND_HALF_MULTIPLIER, TIME_AND_QUARTER_MULTIPLIER, TIME_AND_THREE_QUARTERS_MULTIPLIER, DOUBLE_TIME_AND_HALF_MULTIPLIER, DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER, TIME_AND_HALF_HOURS_CAP, DOUBLE_TIME_MULTIPLIER, ZERO_COST_BREAKDOWN
} from './constants';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import { resolveRateSet } from './rate-schedule';
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

// Security annualised rates & their ordinary-rate mapping are now effective-
// dated — see rate-schedule.ts (audit Phase 2). They are resolved per shift from
// resolveRateSet(shift_date).security, so cl 25.1 CPI increases are data, not code.

const ORDINARY_HOURS_CAP_SECURITY = 12.0;

function isSecurityAnnualised(rate: number, annualisedHourly: Record<string, number>): boolean {
  return Object.values(annualisedHourly).includes(rate);
}

function toOrdinaryRate(casualRate: number): number {
  return Math.round((casualRate / CASUAL_LOADING) * 100) / 100;
}

export function estimateDetailedShiftCost(
  options: CostCalculatorOptions,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  // A cancelled shift is not worked and carries no labour cost (audit Phase 1).
  if (options.is_cancelled) return ZERO_COST_BREAKDOWN;

  // Casuals accrue no paid leave — their 25% loading is paid in lieu — so a
  // leave-flagged casual security shift costs nothing (audit Phase 3). Annualised
  // / full-time security is salaried (leave is already within the annual salary),
  // so it falls through to normal pricing.
  if (
    (options.isAnnualLeave || options.isPersonalLeave || options.isCarerLeave) &&
    /casual/i.test(options.employmentType || '')
  ) {
    return ZERO_COST_BREAKDOWN;
  }

  const { netMinutes, rate, shift_date, is_overnight, previousWage, employmentType } = options;

  // audit Phase 2: security annualised/ordinary rates are effective-dated.
  const rateSet = resolveRateSet(shift_date);

  let effectiveRate = rate ?? rateSet.defaultRate;
  if (isNaN(effectiveRate)) effectiveRate = rateSet.defaultRate;

  const isAnnualised = isSecurityAnnualised(effectiveRate, rateSet.security.annualisedHourly);
  const isCasual = !isAnnualised && /casual/i.test(employmentType || '');

  let ordinaryRate = effectiveRate;
  if (isAnnualised) {
    ordinaryRate = rateSet.security.ordinaryFromAnnualised[effectiveRate] ?? effectiveRate;
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
