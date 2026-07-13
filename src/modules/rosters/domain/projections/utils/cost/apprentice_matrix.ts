/**
 * Schedule 4 — Apprentice wage percentages (ICC Sydney EA 2025).
 *
 * Apprentice wages are a PERCENTAGE of the ICC Sydney Level 4 minimum wage
 * (Schedule 4 §1.1–§1.3), so — unlike the trainee dollar matrix — they need no
 * effective-dating of their own: the percentage is fixed and the Level 4 base it
 * multiplies is already resolved from the effective-dated RATE_SCHEDULE. A cl
 * 25.1 CPI uplift therefore flows through automatically.
 *
 * Extracted from standard.ts so the rate-admin UI can display the same numbers
 * the engine prices with (single source of truth).
 */

import type { CostCalculatorOptions } from './types';

/** Percentage (as a 0–1 multiplier) of the Level 4 base rate, per Schedule 4. */
export const APPRENTICE_MATRIX = {
  // §1.1 — junior apprentices, by year of apprenticeship
  standard: {
    no_yr12: { 1: 0.50, 2: 0.60, 3: 0.75, 4: 0.95 },
    yr12:    { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.95 },
  },
  // §1.2 — adult apprentice: 80% of Level 4 in year 1, full rate thereafter
  adult: { 1: 0.80, 2: 1.0, 3: 1.0, 4: 1.0 },
  // school-based apprentices (no §1.8.1 +25% loading — that is a Schedule 5 term)
  school_based: { 1: 0.50, 2: 0.60 },
} as const;

export function getApprenticeMultiplier(options: CostCalculatorOptions): number {
  if (!options.is_apprentice) return 1.0;

  const type = options.apprentice_type || 'standard';
  const year = options.apprentice_year || 1;
  const hasYr12 = options.has_completed_year_12 || false;

  let multiplier = 1.0;

  if (type === 'adult') {
    multiplier = (APPRENTICE_MATRIX.adult as any)[year] || 1.0;
  } else if (type === 'school_based') {
    // Schedule 4 (Apprentices) prescribes NO +25% loading for school-based
    // apprentices — that in-lieu-of-leave loading is a Schedule 5 (Trainees)
    // provision (§1.8.1) and is opt-in. Applying it here over-paid apprentices.
    multiplier = (APPRENTICE_MATRIX.school_based as any)[year] || 0.50;
  } else {
    const branch = hasYr12 ? APPRENTICE_MATRIX.standard.yr12 : APPRENTICE_MATRIX.standard.no_yr12;
    multiplier = (branch as any)[year] || 0.50;
  }

  return multiplier;
}

/**
 * Schedule 6 — Supported Wage System (reference only).
 * SWS pay = the assessed-capacity percentage of the relevant minimum wage
 * (§1.4.1), with a hard floor of $90/week (§1.4.2). The engine applies the
 * percentage inline (`is_sws` branch in standard.ts) and NOW enforces the $90/wk
 * floor WHEN the caller supplies the member's total ordinary hours for the week
 * (`swsWeeklyHours`): the floor becomes SWS_MIN_WEEKLY / swsWeeklyHours and the
 * rate is lifted to the greater of it and the assessed rate. Without that weekly
 * hours input the floor is a documented no-op (the roster pipeline does not yet
 * compute per-member weekly SWS hours — the remaining connection point).
 */
export const SWS_MIN_WEEKLY = 90;
/** Assessed-capacity → % of relevant minimum wage (identity map, §1.4.1). */
export const SWS_CAPACITY_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
