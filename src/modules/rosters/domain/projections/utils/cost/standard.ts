import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import { 
  hd, WAGE_RATES, DEFAULT_RATE, ORDINARY_HOURS_CAP
} from './constants';
import { getTraineeBaseRate } from './trainee_matrix';
import type { AwardContext } from './award-context';
import { getDateFacts, parseTimeToMinutes, fastNightMinutes } from './award-context';

/**
 * Standard ICC Sydney Cost Engine
 * Handles General Event Staff, Apprentices (Sched 4), Trainees (Sched 5), and SWS (Sched 6)
 *
 * Performance:
 *   - Uses mandatory AwardContext for O(1) date lookups (built once per projection).
 *   - Uses pure integer arithmetic for all time calculations.
 *   - ZERO allocations in the hot loop.
 */

const APPRENTICE_MATRIX = {
  standard: {
    no_yr12: { 1: 0.50, 2: 0.60, 3: 0.75, 4: 0.95 },
    yr12:    { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.95 }
  },
  adult: { 1: 0.80, 2: 1.0, 3: 1.0, 4: 1.0 },
  school_based: { 1: 0.50, 2: 0.60 }
};

function getApprenticeMultiplier(options: CostCalculatorOptions): number {
  if (!options.is_apprentice) return 1.0;
  
  const type = options.apprentice_type || 'standard';
  const year = options.apprentice_year || 1;
  const hasYr12 = options.has_completed_year_12 || false;
  
  let multiplier = 1.0;
  
  if (type === 'adult') {
    multiplier = (APPRENTICE_MATRIX.adult as any)[year] || 1.0;
  } else if (type === 'school_based') {
    multiplier = (APPRENTICE_MATRIX.school_based as any)[year] || 0.50;
    multiplier *= 1.25;
  } else {
    const branch = hasYr12 ? APPRENTICE_MATRIX.standard.yr12 : APPRENTICE_MATRIX.standard.no_yr12;
    multiplier = (branch as any)[year] || 0.50;
  }
  
  return multiplier;
}

function getNightAllowanceMultiplier(conclusionDay: number, isCasual: boolean): number {
  // 0 = Sunday, 1 = Monday, etc.
  if (isCasual) {
    if (conclusionDay >= 1 && conclusionDay <= 4) return 0.45; // Mon-Thu
    if (conclusionDay === 5) return 0.50; // Fri
    return 0.75; // Sat (6), Sun (0)
  } else {
    if (conclusionDay >= 1 && conclusionDay <= 4) return 0.20; // Mon-Thu
    if (conclusionDay === 5) return 0.25; // Fri
    return 0.50; // Sat (6), Sun (0)
  }
}

/**
 * Compute night-shift end day-of-week from integer time values.
 */
function fastEndDayOfWeek(shiftDateDayOfWeek: number, endMins: number, isOvernight: boolean): number {
  if (isOvernight || endMins > 1440) {
    return (shiftDateDayOfWeek + 1) % 7;
  }
  return shiftDateDayOfWeek;
}

// ── Zero-allocation helper for empty/NaN results ─────────────────────────────

const ZERO_RESULT: ShiftCostBreakdown = Object.freeze({
  totalCost: 0, ordinaryCost: 0, overtimeCost: 0, penaltyCost: 0,
  allowanceCost: 0, ordinaryHours: 0, overtimeHours: 0,
  breakdown: Object.freeze({ baseRate: 0, ordinaryRate: 0, penaltyRate: 0, isCasual: false, nightHours: 0, nightAllowanceCost: 0 }),
}) as ShiftCostBreakdown;

/**
 * Main cost calculation entry point.
 */
export function estimateDetailedShiftCost(
  options: CostCalculatorOptions,
  ctx?: AwardContext,
): ShiftCostBreakdown {
  const { netMinutes, rate, is_overnight, employmentType } = options;
  
  // Force shift_date to a YYYY-MM-DD string
  let shift_date = options.shift_date;
  if (shift_date && typeof shift_date === 'object' && (shift_date as any) instanceof Date) {
    shift_date = ((shift_date as any) as Date).toISOString().split('T')[0];
  } else if (typeof shift_date === 'string' && shift_date.includes('T')) {
    shift_date = shift_date.split('T')[0];
  }
  
  // ── Date facts (Phase 3) ───────────────────────────────────────────────
  let isHoliday: boolean;
  let dayOfWeek: number;

  if (ctx) {
    const facts = getDateFacts(ctx, shift_date);
    isHoliday = facts.isPublicHoliday;
    dayOfWeek = facts.dayOfWeek;
  } else {
    isHoliday = !!hd.isHoliday(shift_date);
    const dateObj = new Date(shift_date + 'T00:00:00');
    dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getDay();
  }

  const isCasual = /casual/i.test(employmentType || '');
  const isPartTime = /part/i.test(employmentType || '');
  
  let baseRate = rate;

  // ── 2. Base Rate Resolution ─────────────────────────────────────────
  // If the rate is missing (null, 0, or undefined) or set to the sentinel 24.1, 
  // we attempt to resolve it via classification level mapping.
  if ((!baseRate || Number(baseRate) === 24.1) && options.classificationLevel) {
    const levelKey = options.classificationLevel.toUpperCase().replace(/\s+/g, '_') as keyof typeof WAGE_RATES;
    const rates = WAGE_RATES[levelKey];
    if (rates) {
      baseRate = isCasual ? rates.casual : rates.permanent;
    }
  }

  baseRate = (baseRate === null || baseRate === undefined || isNaN(Number(baseRate))) ? DEFAULT_RATE : Number(baseRate);

  if (options.is_sws) {
    const capacity = options.sws_capacity_percentage || 100;
    baseRate = baseRate * (capacity / 100);
  } 
  else if (options.is_trainee) {
    baseRate = getTraineeBaseRate({
      category: options.trainee_category || 'junior',
      level: options.trainee_level || 'A',
      exitYear: (options.trainee_exit_year as any) || 12,
      yearsOut: options.trainee_years_out || 0,
      aqfLevel: (options.trainee_aqf_level as any) || 3,
      yearOfTraineeship: options.trainee_year || 1,
      isPartTime
    });

    if (isPartTime && options.is_training_on_job) {
      baseRate *= 0.8;
    }

    if (options.trainee_category === 'school_based' && options.prefers_sba_loading) {
      baseRate *= 1.25;
    }
  } 
  else if (options.is_apprentice) {
    baseRate *= getApprenticeMultiplier(options);
  }

  const ordinaryRate = isCasual ? baseRate / 1.25 : baseRate;
  if (isNaN(ordinaryRate)) return ZERO_RESULT;

  // ── Net minutes calculation (Pure integer arithmetic) ──────────────────
  const rawMins = netMinutes || (options as any).net_length_minutes || (options as any).netLengthMinutes;
  let calculatedMins = typeof rawMins === 'number' ? rawMins : Number(rawMins);
  
  if (!calculatedMins || isNaN(calculatedMins) || calculatedMins <= 0) {
    if (options.start_time && options.end_time) {
      const sTime = String(options.start_time).substring(0, 5);
      const eTime = String(options.end_time).substring(0, 5);
      const sMins = parseTimeToMinutes(sTime);
      let eMins = parseTimeToMinutes(eTime);
      if (eMins <= sMins || is_overnight) eMins += 1440;
      calculatedMins = eMins - sMins;
    }
  }

  const netHours = Math.max(0, (calculatedMins || 0) / 60);
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP);

  // ── Penalty multipliers ────────────────────────────────────────────────
  let penaltyRate = baseRate;
  if (isHoliday) {
    penaltyRate = isCasual ? ordinaryRate * 2.75 : ordinaryRate * 2.5;
  } else {
    if (dayOfWeek === 6) { // Saturday
      penaltyRate = isCasual ? ordinaryRate * 1.5 : ordinaryRate * 1.25;
    } else if (dayOfWeek === 0) { // Sunday
      penaltyRate = isCasual ? ordinaryRate * 1.75 : ordinaryRate * 1.5;
    }
  }

  const ordinaryCost = ordinaryHours * penaltyRate;
  
  // ── 4. Night Shift Allowance (Clause 43) ─────────────────────────────
  let nightAllowanceCost = 0;
  let nightHours = 0;

  if (options.start_time && options.end_time) {
    const sTime = String(options.start_time).substring(0, 5);
    const eTime = String(options.end_time).substring(0, 5);

    const startMins = parseTimeToMinutes(sTime);
    let endMins = parseTimeToMinutes(eTime);
    if (endMins <= startMins || is_overnight) endMins += 1440;

    const ordinaryEndMins = startMins + (ordinaryHours * 60);
    const nightMins = fastNightMinutes(startMins, ordinaryEndMins);
    nightHours = Math.max(0, nightMins / 60);

    const endDay = fastEndDayOfWeek(dayOfWeek, endMins, !!is_overnight);
    const allowanceMultiplier = getNightAllowanceMultiplier(endDay, isCasual) || 0;
    nightAllowanceCost = nightHours * ordinaryRate * allowanceMultiplier;
  }

  // 5. Overtime Calculation (Clause 42)
  const scheduledHours = (options.scheduled_length_minutes || 0) / 60;
  let overtimeHours = 0;
  
  if (!isCasual && scheduledHours > 0) {
    // FT/PT: OT is excess of rostered hours OR excess of daily ordinary cap (12h)
    overtimeHours = Math.max(0, netHours - scheduledHours, netHours - ORDINARY_HOURS_CAP);
  } else {
    // Casuals: OT is after the daily ordinary cap
    overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP);
  }

  const ot_th = Math.min(overtimeHours, 3);
  const ot_dt = Math.max(0, overtimeHours - 3);
  
  let overtimeCost = 0;
  if (isHoliday) {
    // Public Holiday OT is 2.5x (Double Time and a Half)
    overtimeCost = overtimeHours * 2.5 * ordinaryRate;
  } else {
    // Standard OT: 1.5x for first 3h, 2.0x thereafter (loading absorbed for casuals)
    overtimeCost = (ot_th * 1.5 + ot_dt * 2.0) * ordinaryRate;
  }

  const totalCost = (ordinaryCost || 0) + (overtimeCost || 0) + (nightAllowanceCost || 0);

  return {
    totalCost: isNaN(totalCost) ? 0 : totalCost,
    ordinaryCost: isNaN(ordinaryCost) ? 0 : ordinaryCost,
    overtimeCost: isNaN(overtimeCost) ? 0 : overtimeCost,
    penaltyCost: isNaN(nightAllowanceCost) ? 0 : nightAllowanceCost, // Approximation
    allowanceCost: isNaN(nightAllowanceCost) ? 0 : nightAllowanceCost,
    ordinaryHours: ordinaryHours || 0,
    overtimeHours: overtimeHours || 0,
    breakdown: {
      baseRate: baseRate || 0,
      ordinaryRate: ordinaryRate || 0,
      penaltyRate: penaltyRate || 0,
      isCasual,
      isApprentice: !!options.is_apprentice,
      isTrainee: !!options.is_trainee,
      nightHours: nightHours || 0,
      nightAllowanceCost: nightAllowanceCost || 0
    }
  };
}

export function estimateShiftCost(options: CostCalculatorOptions, ctx?: AwardContext): number {
  return estimateDetailedShiftCost(options, ctx).totalCost;
}

function toOrdinaryRate(rate: number): number {
  return rate / 1.25;
}
