// Re-export the app-wide AU/NSW holiday instance so the cost engine and the
// calendar UI share a single source of truth for public holidays.
export { ausHolidays as hd } from '@/modules/core/lib/holidays';

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

// Allowance Constants (Clause 28 / Schedule 2 §3 — values as at 2025 vote)
export const ALLOWANCE_MEAL = 13.61;              // per occasion (cl. 28.1)
export const ALLOWANCE_FIRST_AID_PER_HOUR = 0.56; // per ordinary hour (cl. 28.2)
export const ALLOWANCE_PROTEIN_SPILL = 7.17;      // per shift (cl. 28.3)
export const ALLOWANCE_SPLIT_SHIFT = 11.13;       // per shift (cl. 28.4)

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

// ── Estimate labelling (audit Phase 1) ───────────────────────────────────────
// This module is an AWARD-COST ESTIMATOR, not a payroll system. Every UI surface
// that renders its dollar output must label it as an estimate and must never
// present it as payable pay. These shared strings keep that wording consistent
// across the roster cards, my-roster dialog, timesheet table and exports.
export const COST_ESTIMATE_LABEL = 'Est. cost';
export const COST_ESTIMATE_TITLE = 'Estimated cost (not payroll)';
export const COST_ESTIMATE_DISCLAIMER =
  'Award estimate only — not payroll. Excludes leave loading, weekly-averaged overtime and future CPI indexation.';

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
