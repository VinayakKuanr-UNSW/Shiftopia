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
import type { RateSet } from './rate-schedule';

/** Percentage (as a 0–1 multiplier) of the Level 4 base rate, per Schedule 4. */
export const APPRENTICE_MATRIX = {
  // §1.1 — junior apprentices, by year of apprenticeship
  standard: {
    no_yr12: { 1: 0.50, 2: 0.60, 3: 0.75, 4: 0.95 },
    yr12:    { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.95 },
  },
  // §1.2 — adult apprentice year 1: greater of 80% of Level 4 or the junior
  // %-table rate for year 1 (80% always wins in practice: junior year-1 is
  // only 50/55%). §1.3 — years 2-4: greater of the LOWEST ADULT
  // CLASSIFICATION (Level 1) minimum wage or the junior %-table rate for
  // that year — NOT a flat 100% of Level 4 (compliance audit finding —
  // 2026-08-02: a flat 100% always overpaid relative to the clause's actual
  // floor, by roughly 5-12% in years 2-3). See `getApprenticeMultiplier`,
  // which computes this comparison against the effective-dated rate
  // schedule rather than a fixed literal.
  adult: { 1: 0.80 },
  // school-based apprentices (no §1.8.1 +25% loading — that is a Schedule 5 term)
  school_based: { 1: 0.50, 2: 0.60 },
} as const;

/**
 * cl 1.2/1.3 — the adult apprentice multiplier, expressed as a fraction of
 * the (effective-dated) Level 4 base rate. Year 1: greater of 80% of Level 4
 * or the junior %-table rate for year 1. Years 2-4: greater of the Level 1
 * minimum wage or the junior %-table rate for that year — NOT a flat 100%
 * of Level 4. Shared by `getApprenticeMultiplier` (the engine) and
 * `getAdultApprenticeEffectivePct` (the rate-admin display) so the two can
 * never diverge.
 */
function adultApprenticeMultiplier(rateSet: RateSet, year: number, hasYr12: boolean): number {
  const juniorBranch = hasYr12 ? APPRENTICE_MATRIX.standard.yr12 : APPRENTICE_MATRIX.standard.no_yr12;
  const juniorPct = (juniorBranch as any)[year] ?? APPRENTICE_MATRIX.standard.no_yr12[4];
  const level4Rate = rateSet.wageRates.LEVEL_4.permanent;
  if (!(level4Rate > 0)) return juniorPct; // defensive fallback — should never happen with a real RateSet
  const juniorRate = level4Rate * juniorPct;
  const floorRate = year <= 1
    ? Math.max(level4Rate * APPRENTICE_MATRIX.adult[1], juniorRate)       // cl 1.2
    : Math.max(rateSet.wageRates.LEVEL_1.permanent, juniorRate);          // cl 1.3
  return floorRate / level4Rate;
}

/**
 * Returns the multiplier to apply to the (effective-dated) Level 4 base
 * rate for an apprentice, per Schedule 4. `rateSet` is required for the
 * ADULT branch, since cl 1.2/1.3's floor is expressed relative to Level 4
 * and Level 1 minimum wages, not a fixed percentage — both figures must
 * come from the SAME effective-dated rate set so a future cl 25.1 CPI
 * increase doesn't change their relative comparison.
 */
export function getApprenticeMultiplier(options: CostCalculatorOptions, rateSet: RateSet): number {
  if (!options.is_apprentice) return 1.0;

  const type = options.apprentice_type || 'standard';
  const year = options.apprentice_year || 1;
  const hasYr12 = options.has_completed_year_12 || false;

  if (type === 'adult') {
    return adultApprenticeMultiplier(rateSet, year, hasYr12);
  }
  if (type === 'school_based') {
    // Schedule 4 (Apprentices) prescribes NO +25% loading for school-based
    // apprentices — that in-lieu-of-leave loading is a Schedule 5 (Trainees)
    // provision (§1.8.1) and is opt-in. Applying it here over-paid apprentices.
    return (APPRENTICE_MATRIX.school_based as any)[year] || 0.50;
  }
  const branch = hasYr12 ? APPRENTICE_MATRIX.standard.yr12 : APPRENTICE_MATRIX.standard.no_yr12;
  return (branch as any)[year] || 0.50;
}

/**
 * The EFFECTIVE percentage-of-Level-4 for an adult apprentice year, for the
 * rate-admin UI's display cards only. cl 1.3's years-2-4 floor is "greater
 * of Level 1 or junior %", not a fixed percentage, so this resolves that
 * comparison against a given effective-dated `rateSet` (typically "today")
 * purely so the UI can still show one number per year. Identical formula to
 * `getApprenticeMultiplier`'s adult branch — never let the two diverge.
 */
export function getAdultApprenticeEffectivePct(
  rateSet: RateSet,
  year: 1 | 2 | 3 | 4,
  hasYr12: boolean,
): number {
  return adultApprenticeMultiplier(rateSet, year, hasYr12);
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
