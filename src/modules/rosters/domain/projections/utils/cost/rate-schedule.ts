/**
 * Effective-dated ICC Sydney EA 2025 wage & allowance schedule.
 *
 * WHY THIS EXISTS (audit Phase 2)
 * ───────────────────────────────
 * Wage and allowance amounts were hardcoded as a single flat snapshot in
 * `constants.ts`. Clause 25.1 of the EA requires a CPI + 0.5% increase from the
 * first pay period on or after 1 July 2026, 2027 and 2028. With a flat snapshot
 * every one of those increases would silently make every estimate stale, and a
 * historical shift could never be re-priced at the rate that actually applied on
 * its own date.
 *
 * This module turns the rate/allowance set into an EFFECTIVE-DATED SCHEDULE that
 * the (synchronous, worker-safe) cost engine resolves by `shift_date`. Adding a
 * future increase becomes a pure DATA change — no engine edit:
 *
 *   RATE_SCHEDULE.push(applyCpiIncrease(RATE_SCHEDULE[0], cpiPct, '2026-07-01',
 *     'ICC Sydney EA 2025 — 1 Jul 2026 increase (CPI + 0.5%, cl 25.1)'));
 *
 * The durable, auditable copy of this schedule lives in the DB tables
 * `public.eba_rate` / `public.eba_allowance` (migration
 * 20260709000000_eba_rate_allowance_effective_dated.sql). This TS schedule is
 * the EMBEDDED copy the worker engine reads; the DB tables mirror it. They must
 * be kept in sync until a generator makes the DB the single source (audit
 * Phase 3 — "one canonical interpreter").
 *
 * DRIFT GUARD (do not edit these two files' values in isolation)
 * ─────────────────────────────────────────────────────────────
 * Because the worker engine cannot read the DB at runtime, RATE_SCHEDULE must
 * stay a static in-code copy — so the two copies are kept machine-checkable:
 *   • Generator: `scripts/gen-eba-rate-schedule.mjs` (run `npm run gen:eba-rates`)
 *     parses the eba_rate/eba_allowance seed rows out of the migration SQL and
 *     emits the canonical RateSet-shaped dataset.
 *   • Sync test: `src/modules/rosters/domain/__tests__/cost/rate-schedule-sync.test.ts`
 *     asserts those parsed DB values EXACTLY equal RATE_SCHEDULE[0]
 *     (resolveRateSet('2025-01-01')) — every wage level, defaultRate, all four
 *     allowances, and the security annualised→ordinary map. If the migration and
 *     this schedule ever diverge, that test fails. So: change a 2025 value here
 *     ⇒ change it in the migration too (and vice-versa).
 *
 * PUBLIC API IS FROZEN: RATE_SCHEDULE, resolveRateSet, applyCpiIncrease and the
 * exported types (RateSet/WageRateTable/AllowanceTable/SecurityRateTable) are
 * depended on elsewhere — do not rename/reshape them.
 *
 * NOTE (cl 25.2): CPI = ABS 'All Groups CPI' % change (Sydney), March-quarter
 * year-on-year. NOTE (cl 25.3): rates must stay ≥ 2% above the Amusement, Events
 * and Recreation Award — that floor is NOT auto-enforced here (the Award rate is
 * not available to this module) and must be checked when a new row is added.
 */

import {
  WAGE_RATES,
  DEFAULT_RATE,
  ALLOWANCE_MEAL,
  ALLOWANCE_FIRST_AID_PER_HOUR,
  ALLOWANCE_PROTEIN_SPILL,
  ALLOWANCE_SPLIT_SHIFT,
} from './constants';

export type WageRateTable = typeof WAGE_RATES;

export interface AllowanceTable {
  meal: number;            // per occasion (cl 28.1 / Sch 2 §3)
  firstAidPerHour: number; // per ordinary hour (cl 28.2)
  proteinSpill: number;    // per shift (cl 28.3)
  splitShift: number;      // per shift (cl 28.4)
}

export interface SecurityRateTable {
  /** Full-time security annualised hourly rate (Schedule 2 §2). */
  annualisedHourly: Record<'level3' | 'level4' | 'level5' | 'level6', number>;
  /** Map an annualised hourly rate → the equivalent ordinary hourly rate. */
  ordinaryFromAnnualised: Record<number, number>;
}

export interface RateSet {
  /** Inclusive lower bound (YYYY-MM-DD). Applies until the next entry's date. */
  effectiveFrom: string;
  label: string;
  source: string;
  /** Fallback ordinary/base rate when a shift has neither a rate nor a level. */
  defaultRate: number;
  wageRates: WageRateTable;
  allowances: AllowanceTable;
  security: SecurityRateTable;
}

// ── Baseline: EA 2025 commencement (values mirror constants.ts exactly) ───────
const EA_2025: RateSet = {
  effectiveFrom: '2025-01-01',
  label: 'ICC Sydney EA 2025 — commencement (2025 vote)',
  source: 'Schedule 2 §1–§3',
  defaultRate: DEFAULT_RATE,
  wageRates: WAGE_RATES,
  allowances: {
    meal: ALLOWANCE_MEAL,
    firstAidPerHour: ALLOWANCE_FIRST_AID_PER_HOUR,
    proteinSpill: ALLOWANCE_PROTEIN_SPILL,
    splitShift: ALLOWANCE_SPLIT_SHIFT,
  },
  security: {
    annualisedHourly: { level3: 32.20, level4: 34.63, level5: 37.06, level6: 39.48 },
    ordinaryFromAnnualised: { 32.20: 27.23, 34.63: 28.79, 37.06: 30.82, 39.48: 32.82 },
  },
};

// ── FY2026/2027: +5.1% from the first pay period on/after 6 Jul 2026 ───────────
// The FY26/27 EBA variation raises ALL wage rates and allowances by 5.1%. These
// figures are TRANSCRIBED FROM THE PUBLISHED EBA Schedule 2 tables — NOT computed
// as base × 1.051. A naive multiply diverges by a cent in several casual/security/
// protein-spill cells (the annualised hourly rates are published as annual salary
// ÷ annual hours, e.g. L4 $79,479.12 / 2184h = $36.39, where ×1.051 would give
// $36.40). So this set is hand-entered and machine-checked against the DB seed by
// rate-schedule-fy2026-sync.test.ts — it is deliberately NOT derived via
// applyCpiIncrease (which encodes the cl 25.1 CPI+0.5% shape, not a flat 5.1%).
const EA_2026: RateSet = {
  effectiveFrom: '2026-07-06',
  label: 'ICC Sydney EA — FY2026/2027 (5.1% increase)',
  source: 'Schedule 2 §1–§3 · +5.1% from first pay period on/after 6 Jul 2026',
  defaultRate: 33.70, // Level 1 casual (same role as constants.DEFAULT_RATE)
  wageRates: {
    TRAINEE: { permanent: 26.23, casual: 32.79 },
    LEVEL_1: { permanent: 26.96, casual: 33.70 },
    LEVEL_2: { permanent: 27.71, casual: 34.64 },
    LEVEL_3: { permanent: 28.62, casual: 35.77 },
    LEVEL_4: { permanent: 30.26, casual: 37.82 },
    LEVEL_5: { permanent: 32.39, casual: 40.49 },
    LEVEL_6: { permanent: 34.49, casual: 43.12 },
    LEVEL_7: { permanent: 35.93, casual: 44.92 },
  },
  allowances: {
    meal: 14.30,
    firstAidPerHour: 0.59,
    proteinSpill: 7.53,
    splitShift: 11.70,
  },
  security: {
    annualisedHourly: { level3: 33.84, level4: 36.39, level5: 38.95, level6: 41.49 },
    ordinaryFromAnnualised: { 33.84: 28.62, 36.39: 30.26, 38.95: 32.39, 41.49: 34.49 },
  },
};

/**
 * The effective-dated schedule, ascending by `effectiveFrom`.
 * FY2026/2027 (+5.1%, from 6 Jul 2026) is a flat published increase and is
 * hand-entered above. Add the 1 Jul 2027/28 cl 25.1 CPI+0.5% increases here once
 * the ABS March-quarter Sydney CPI is published — do NOT invent the figure. Each
 * new entry must be mirrored into the DB (eba_rate/eba_allowance) and guarded by
 * a *-sync.test.ts, and checked against cl 25.3 (≥ 2% above the AER Award).
 */
export const RATE_SCHEDULE: RateSet[] = [EA_2025, EA_2026];

function normalizeDate(d?: string | null): string {
  if (!d) return '';
  const s = String(d);
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

/**
 * Resolve the rate set in force on `shiftDate` — the entry with the latest
 * `effectiveFrom` that is on or before the date. Dates before the earliest
 * entry (or missing/invalid) fall back to the earliest set. ISO YYYY-MM-DD
 * strings compare correctly lexicographically, so no Date allocation is needed.
 */
export function resolveRateSet(
  shiftDate?: string | null,
  schedule: RateSet[] = RATE_SCHEDULE,
): RateSet {
  const date = normalizeDate(shiftDate);
  let earliest = schedule[0];
  let applicable: RateSet | undefined;
  for (const rs of schedule) {
    if (rs.effectiveFrom < earliest.effectiveFrom) earliest = rs;
    if (rs.effectiveFrom <= date && (!applicable || rs.effectiveFrom > applicable.effectiveFrom)) {
      applicable = rs;
    }
  }
  return applicable ?? earliest;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Derive the next period's RateSet from a base set by applying the EA's annual
 * increase (cl 25.1 = CPI + 0.5%). Pure — never mutates `base`. This is how a
 * 1 July increase is added as data; see the file header.
 *
 * @param cpiPercent ABS All-Groups CPI (Sydney), March-quarter YoY % (cl 25.2)
 */
export function applyCpiIncrease(
  base: RateSet,
  cpiPercent: number,
  effectiveFrom: string,
  label: string,
): RateSet {
  const factor = 1 + (cpiPercent + 0.5) / 100; // cl 25.1

  const wageRates = {} as WageRateTable;
  (Object.keys(base.wageRates) as (keyof WageRateTable)[]).forEach((k) => {
    wageRates[k] = {
      permanent: r2(base.wageRates[k].permanent * factor),
      casual: r2(base.wageRates[k].casual * factor),
    };
  });

  const annualisedHourly = {
    level3: r2(base.security.annualisedHourly.level3 * factor),
    level4: r2(base.security.annualisedHourly.level4 * factor),
    level5: r2(base.security.annualisedHourly.level5 * factor),
    level6: r2(base.security.annualisedHourly.level6 * factor),
  };

  const ordinaryFromAnnualised: Record<number, number> = {};
  Object.entries(base.security.ordinaryFromAnnualised).forEach(([annual, ordinary]) => {
    ordinaryFromAnnualised[r2(Number(annual) * factor)] = r2(Number(ordinary) * factor);
  });

  return {
    effectiveFrom,
    label,
    source: `CPI ${cpiPercent}% + 0.5% (cl 25.1) applied to ${base.label}`,
    defaultRate: r2(base.defaultRate * factor),
    wageRates,
    allowances: {
      meal: r2(base.allowances.meal * factor),
      firstAidPerHour: r2(base.allowances.firstAidPerHour * factor),
      proteinSpill: r2(base.allowances.proteinSpill * factor),
      splitShift: r2(base.allowances.splitShift * factor),
    },
    security: { annualisedHourly, ordinaryFromAnnualised },
  };
}
