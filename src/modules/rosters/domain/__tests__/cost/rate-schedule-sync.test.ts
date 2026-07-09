/**
 * rate-schedule-sync.test.ts — DB migration ⇄ TS schedule drift guard
 * ────────────────────────────────────────────────────────────────────────────
 * There are two copies of the EA 2025 wage/allowance rates:
 *   1. The DB migration (durable, auditable source of truth):
 *      supabase/migrations/20260709000000_eba_rate_allowance_effective_dated.sql
 *      (seeds public.eba_rate + public.eba_allowance).
 *   2. The static, in-code schedule the worker-safe cost engine actually reads:
 *      rate-schedule.ts → RATE_SCHEDULE[0] (resolveRateSet('2025-01-01')).
 *
 * The engine runs in a projection worker with no Supabase access, so copy #2
 * MUST remain a static in-code copy — it cannot read the DB at runtime. This
 * test parses the seeded rows straight out of the migration SQL (via the same
 * derivation the generator scripts/gen-eba-rate-schedule.mjs uses) and asserts
 * they EXACTLY equal what RATE_SCHEDULE[0] exposes. Any future divergence
 * between the migration and the TS schedule is therefore a failing test.
 *
 * To regenerate/inspect the canonical dataset: `npm run gen:eba-rates`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveRateSet } from '../../projections/utils/cost/rate-schedule';
import {
  deriveRateSetFromMigration,
  BASELINE_EFFECTIVE_FROM,
} from '../../../../../../scripts/gen-eba-rate-schedule.mjs';

// Resolve the migration path relative to this test file (independent of cwd).
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../../../supabase/migrations/20260709000000_eba_rate_allowance_effective_dated.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const fromDb = deriveRateSetFromMigration(sql);
const fromTs = resolveRateSet(BASELINE_EFFECTIVE_FROM); // === RATE_SCHEDULE[0]

describe('rate-schedule sync — DB migration eba_rate/eba_allowance ⇄ RATE_SCHEDULE[0]', () => {
  it('parses the expected number of seeded rows (sanity)', () => {
    // 8 classifications × {permanent, casual} = 16 wage rows,
    // 4 security annualised rows, 4 allowance rows.
    expect(fromDb._counts).toEqual({
      wageRows: 16,
      securityRows: 4,
      allowanceRows: 4,
    });
  });

  it('the schedule baseline is the 2025 commencement row', () => {
    expect(fromTs.effectiveFrom).toBe(BASELINE_EFFECTIVE_FROM);
    expect(fromDb.effectiveFrom).toBe(BASELINE_EFFECTIVE_FROM);
  });

  it('every wage level (permanent + casual) matches the DB seed exactly', () => {
    const levels = Object.keys(fromTs.wageRates) as (keyof typeof fromTs.wageRates)[];
    // The DB must expose exactly the same classification set — no more, no less.
    expect(new Set(Object.keys(fromDb.wageRates))).toEqual(new Set(levels));

    let compared = 0;
    for (const lvl of levels) {
      expect(fromDb.wageRates[lvl], `missing wage row for ${lvl}`).toBeDefined();
      expect(fromDb.wageRates[lvl].permanent, `${lvl}.permanent`).toBe(
        fromTs.wageRates[lvl].permanent,
      );
      expect(fromDb.wageRates[lvl].casual, `${lvl}.casual`).toBe(
        fromTs.wageRates[lvl].casual,
      );
      compared += 2;
    }
    expect(compared).toBe(16); // 8 levels × 2 bases
  });

  it('defaultRate matches (Level 1 casual paid rate)', () => {
    expect(fromDb.defaultRate).toBe(fromTs.defaultRate);
  });

  it('all four allowances match the DB seed exactly', () => {
    expect(fromDb.allowances.meal).toBe(fromTs.allowances.meal);
    expect(fromDb.allowances.firstAidPerHour).toBe(fromTs.allowances.firstAidPerHour);
    expect(fromDb.allowances.proteinSpill).toBe(fromTs.allowances.proteinSpill);
    expect(fromDb.allowances.splitShift).toBe(fromTs.allowances.splitShift);
    // Whole object equality catches any extra/renamed allowance key too.
    expect(fromDb.allowances).toEqual(fromTs.allowances);
  });

  it('security annualised hourly rates match the DB seed exactly', () => {
    expect(fromDb.security.annualisedHourly).toEqual(fromTs.security.annualisedHourly);
  });

  it('security annualised→ordinary map matches the DB seed exactly', () => {
    // Compare with numeric-string keys normalised (JS object keys are strings).
    const norm = (m: Record<number, number>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [String(Number(k)), v]));
    expect(norm(fromDb.security.ordinaryFromAnnualised)).toEqual(
      norm(fromTs.security.ordinaryFromAnnualised),
    );
  });

  it('the DB seed and RATE_SCHEDULE[0] agree on the ENTIRE 2025 dataset', () => {
    // One structural assertion over the whole RateSet payload — the strongest
    // guard: if the migration and the TS schedule ever diverge on any value or
    // key, this fails. Provenance strings (label/source) are intentionally not
    // compared (they document the SAME row, not a rate value).
    const project = (rs: {
      effectiveFrom: string;
      defaultRate: number;
      wageRates: unknown;
      allowances: unknown;
      security: { annualisedHourly: unknown; ordinaryFromAnnualised: Record<number, number> };
    }) => ({
      effectiveFrom: rs.effectiveFrom,
      defaultRate: rs.defaultRate,
      wageRates: rs.wageRates,
      allowances: rs.allowances,
      security: {
        annualisedHourly: rs.security.annualisedHourly,
        ordinaryFromAnnualised: Object.fromEntries(
          Object.entries(rs.security.ordinaryFromAnnualised).map(([k, v]) => [
            String(Number(k)),
            v,
          ]),
        ),
      },
    });
    expect(project(fromDb)).toEqual(project(fromTs));
  });
});
