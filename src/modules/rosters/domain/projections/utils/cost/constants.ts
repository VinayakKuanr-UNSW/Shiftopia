import Holidays from 'date-holidays';

export const hd = new Holidays('AU', 'NSW');

export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;
export const FRIDAY = 5;
export const SATURDAY = 6;

// Clause 43 Night Shift Multipliers
export const TIME_AND_QUARTER_MULTIPLIER = 1.25;
export const TIME_AND_HALF_MULTIPLIER = 1.5;
export const TIME_AND_THREE_QUARTERS_MULTIPLIER = 1.75;
export const DOUBLE_TIME_MULTIPLIER = 2.0;
export const DOUBLE_TIME_AND_HALF_MULTIPLIER = 2.5;
export const DOUBLE_TIME_AND_THREE_QUARTERS_MULTIPLIER = 2.75;

// Loading Constants
export const CASUAL_LOADING = 1.25;
export const ANNUAL_LEAVE_LOADING = 0.175;
export const ADDITIONAL_LOADING1 = 0.05;
export const ADDITIONAL_LOADING2 = 0.10;

// Allowance Constants (Clause 40)
export const ALLOWANCE_MEAL = 14.50;
export const ALLOWANCE_FIRST_AID_PER_HOUR = 0.50;
export const ALLOWANCE_PROTEIN_SPILL = 20.00;
export const ALLOWANCE_SPLIT_SHIFT = 10.00;

// Thresholds
export const MEAL_ALLOWANCE_OVERTIME_THRESHOLD_HOURS = 2.0;
export const TIME_AND_HALF_HOURS_CAP = 2.0;
export const DEFAULT_RATE = 32.06; // Default to Level 1 Casual
export const ORDINARY_HOURS_CAP = 12;

export const WAGE_RATES = {
  TRAINEE: { permanent: 24.96, casual: 31.20 },
  LEVEL_1: { permanent: 25.65, casual: 32.06 },
  LEVEL_2: { permanent: 26.37, casual: 32.96 },
  LEVEL_3: { permanent: 27.23, casual: 34.04 },
  LEVEL_4: { permanent: 28.79, casual: 35.99 },
  LEVEL_5: { permanent: 30.82, casual: 38.52 },
  LEVEL_6: { permanent: 32.82, casual: 41.03 },
  LEVEL_7: { permanent: 34.19, casual: 42.74 },
};

/**
 * Zero-cost sentinel for unassigned shifts.
 *
 * Used by projectors and the pipeline to skip the payroll engine when a
 * shift has no assigned employee — cost is employee-dependent (employment
 * type, classification level, hourly rate) so it cannot be computed
 * accurately without assignment context.
 */
export const ZERO_COST_BREAKDOWN: import('./types').ShiftCostBreakdown = Object.freeze({
  totalCost: 0,
  ordinaryCost: 0,
  overtimeCost: 0,
  penaltyCost: 0,
  allowanceCost: 0,
  ordinaryHours: 0,
  overtimeHours: 0,
  breakdown: Object.freeze({
    baseRate: 0,
    ordinaryRate: 0,
    penaltyRate: 0,
    isCasual: false,
  }),
});
