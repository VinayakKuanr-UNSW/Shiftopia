
import Holidays from 'date-holidays';
import { parseISO, addDays, subDays, setHours, setMinutes, differenceInMinutes, getDay, isBefore, isAfter, min, max, addMinutes } from 'date-fns';
import { CostCalculatorOptions, ShiftCostBreakdown } from './types';
import { DEFAULT_RATE } from './constants';
import { getTraineeBaseRate } from './trainee_matrix';

/**
 * Standard ICC Sydney Cost Engine
 * Handles General Event Staff, Apprentices (Sched 4), Trainees (Sched 5), and SWS (Sched 6)
 */

const ORDINARY_HOURS_CAP = 7.6;

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

/**
 * Calculates the number of minutes that overlap with the Night Shift window (10:00 PM - 6:00 AM).
 */
function getNightShiftMinutes(start: Date, end: Date): number {
  // Night window A: 10 PM on shift start day to 6 AM the next day
  const window1Start = setMinutes(setHours(start, 22), 0);
  const window1End = addDays(setMinutes(setHours(start, 6), 0), 1);

  // Night window B: 10 PM the day before shift start to 6 AM on shift start day
  const window2Start = subDays(setMinutes(setHours(start, 22), 0), 1);
  const window2End = setMinutes(setHours(start, 6), 0);

  // Function to get overlap between two intervals
  const getOverlap = (s1: Date, e1: Date, s2: Date, e2: Date) => {
    const overlapStart = max([s1, s2]);
    const overlapEnd = min([e1, e2]);
    if (isBefore(overlapStart, overlapEnd)) {
      return differenceInMinutes(overlapEnd, overlapStart);
    }
    return 0;
  };

  return getOverlap(start, end, window1Start, window1End) + getOverlap(start, end, window2Start, window2End);
}

function getNightAllowanceMultiplier(conclusionDay: number, isCasual: boolean): number {
  // getDay() returns 0 for Sunday, 1 for Monday, etc.
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

export function estimateDetailedShiftCost(options: CostCalculatorOptions): ShiftCostBreakdown {
  const { netMinutes, rate, shift_date, is_overnight, allowances, isAnnualLeave, employmentType } = options;
  const hd = new Holidays('AU', 'NSW');
  const isCasual = employmentType === 'Casual';
  const isPartTime = employmentType === 'Part-Time' || employmentType === 'Flexible Part-Time';
  
  let baseRate = rate ?? DEFAULT_RATE;

  // 1. Handle SWS Logic (Schedule 6) - Applies first to the base role rate
  if (options.is_sws) {
    const capacity = options.sws_capacity_percentage || 100;
    baseRate = baseRate * (capacity / 100);
  } 
  // 2. Handle Trainee Logic (Schedule 5)
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
  // 3. Handle Apprentice Logic (Schedule 4)
  else if (options.is_apprentice) {
    baseRate *= getApprenticeMultiplier(options);
  }

  const ordinaryRate = isCasual ? toOrdinaryRate(baseRate) : baseRate;

  const netHours = netMinutes / 60;
  const ordinaryHours = Math.min(netHours, ORDINARY_HOURS_CAP);

  // Penalty multipliers
  let penaltyRate = baseRate;
  if (hd.isHoliday(shift_date)) {
    penaltyRate = isCasual ? ordinaryRate * 2.75 : ordinaryRate * 2.5;
  } else {
    const day = new Date(shift_date).getDay();
    if (day === 6) { // Saturday
      penaltyRate = isCasual ? ordinaryRate * 1.5 : ordinaryRate * 1.25;
    } else if (day === 0) { // Sunday
      penaltyRate = isCasual ? ordinaryRate * 1.75 : ordinaryRate * 1.5;
    }
  }

  const ordinaryCost = ordinaryHours * penaltyRate;
  
  // 4. Night Shift Allowance (Clause 43)
  // Only applies to ordinary hours worked between 10pm and 6am
  let nightAllowanceCost = 0;
  let nightHours = 0;
  if (options.start_time && options.end_time) {
    const shiftStart = parseISO(`${shift_date}T${options.start_time}`);
    // Determine the end of ordinary hours (e.g. after 7.6h)
    const ordinaryEnd = addMinutes(shiftStart, ordinaryHours * 60);
    
    const nightMins = getNightShiftMinutes(shiftStart, ordinaryEnd);
    nightHours = nightMins / 60;
    
    // The allowance percentage is based on the day the *shift* concludes
    const shiftEnd = is_overnight ? addDays(parseISO(`${shift_date}T${options.end_time}`), 1) : parseISO(`${shift_date}T${options.end_time}`);
    const endDay = getDay(shiftEnd);
    const allowanceMultiplier = getNightAllowanceMultiplier(endDay, isCasual);
    
    nightAllowanceCost = nightHours * ordinaryRate * allowanceMultiplier;
  }

  // 5. Overtime Calculation (Clause 42)
  const scheduledHours = (options.scheduled_length_minutes || 0) / 60;
  let overtimeHours = 0;
  
  if (!isCasual && scheduledHours > 0) {
    // FT/PT: OT is excess of rostered hours OR excess of daily ordinary cap (7.6h)
    overtimeHours = Math.max(0, netHours - scheduledHours, netHours - ORDINARY_HOURS_CAP);
  } else {
    // Casuals: OT is after the daily ordinary cap
    overtimeHours = Math.max(0, netHours - ORDINARY_HOURS_CAP);
  }

  const ot_th = Math.min(overtimeHours, 3);
  const ot_dt = Math.max(0, overtimeHours - 3);
  
  let overtimeCost = 0;
  if (hd.isHoliday(shift_date)) {
    // Public Holiday OT is 2.5x (Double Time and a Half)
    overtimeCost = overtimeHours * 2.5 * ordinaryRate;
  } else {
    // Standard OT: 1.5x for first 3h, 2.0x thereafter (loading absorbed for casuals)
    overtimeCost = (ot_th * 1.5 + ot_dt * 2.0) * ordinaryRate;
  }

  const totalCost = ordinaryCost + overtimeCost + nightAllowanceCost;

  return {
    totalCost,
    ordinaryCost,
    overtimeCost,
    penaltyCost: (ordinaryCost - (ordinaryHours * baseRate)) + nightAllowanceCost,
    allowanceCost: nightAllowanceCost,
    ordinaryHours,
    overtimeHours,
    breakdown: {
      baseRate,
      ordinaryRate,
      penaltyRate,
      isCasual,
      isApprentice: !!options.is_apprentice,
      isTrainee: !!options.is_trainee,
      nightHours,
      nightAllowanceCost
    }
  };
}

export function estimateShiftCost(options: CostCalculatorOptions): number {
  return estimateDetailedShiftCost(options).totalCost;
}

function toOrdinaryRate(rate: number): number {
  return rate / 1.25;
}
