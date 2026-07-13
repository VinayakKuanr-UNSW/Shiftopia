/**
 * rate-schedule-fy2026-sync.test.ts — FY2026/27 DB migration ⇄ TS drift guard
 * ────────────────────────────────────────────────────────────────────────────
 * The +5.1% FY26/27 increase (effective 6 Jul 2026) exists in two copies, just
 * like the 2025 baseline:
 *   1. DB migration seed:
 *      supabase/migrations/20260712000000_eba_rate_fy2026.sql
 *      (adds the 2026-07-06 rows to public.eba_rate / public.eba_allowance).
 *   2. Worker-safe engine copy: rate-schedule.ts → RATE_SCHEDULE[1]
 *      (resolveRateSet('2026-07-06')).
 *
 * The FY26/27 Schedule-2 values are HAND-TRANSCRIBED from the published EBA
 * tables (a naive base × 1.051 diverges by a cent in several cells), so this
 * machine check is the safety net against a single-side typo. It reuses the same
 * migration parser as the 2025 guard (rate-schedule-sync.test.ts) via the
 * generator's now-parameterised deriveRateSetFromMigration(sql, effectiveFrom).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveRateSet } from '../../projections/utils/cost/rate-schedule';
import { deriveRateSetFromMigration } from '../../../../../../scripts/gen-eba-rate-schedule.mjs';

const FY2026_EFFECTIVE_FROM = '2026-07-06';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../../../supabase/migrations/20260712000000_eba_rate_fy2026.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const fromDb = deriveRateSetFromMigration(sql, FY2026_EFFECTIVE_FROM);
const fromTs = resolveRateSet(FY2026_EFFECTIVE_FROM); // === RATE_SCHEDULE[1]

describe('rate-schedule sync — FY2026/27 eba_rate/eba_allowance ⇄ RATE_SCHEDULE[1]', () => {
  it('resolves to the FY2026/27 set on/after 6 Jul 2026', () => {
    expect(fromTs.effectiveFrom).toBe(FY2026_EFFECTIVE_FROM);
    expect(fromTs.label).toContain('FY2026/2027');
  });

  it('parses the expected number of seeded rows (sanity)', () => {
    expect(fromDb._counts).toEqual({ wageRows: 16, securityRows: 4, allowanceRows: 4 });
  });

  it('every wage level (permanent + casual) matches the DB seed exactly', () => {
    const levels = Object.keys(fromTs.wageRates) as (keyof typeof fromTs.wageRates)[];
    expect(new Set(Object.keys(fromDb.wageRates))).toEqual(new Set(levels));
    for (const lvl of levels) {
      expect(fromDb.wageRates[lvl].permanent, `${lvl}.permanent`).toBe(fromTs.wageRates[lvl].permanent);
      expect(fromDb.wageRates[lvl].casual, `${lvl}.casual`).toBe(fromTs.wageRates[lvl].casual);
    }
  });

  it('carries the published FY26/27 headline values (transcription guard)', () => {
    // A naive ×1.051 would give these cells one cent different — pin the published
    // figures so a "just multiply" edit can never silently creep back in.
    expect(fromTs.wageRates.LEVEL_3.casual).toBe(35.77); // ×1.051 → 35.78
    expect(fromTs.wageRates.LEVEL_5.casual).toBe(40.49); // ×1.051 → 40.48
    expect(fromTs.security.annualisedHourly.level4).toBe(36.39); // ×1.051 → 36.40
    expect(fromTs.allowances.proteinSpill).toBe(7.53); // ×1.051 → 7.54
    expect(fromTs.defaultRate).toBe(33.70); // Level 1 casual
  });

  it('the DB seed and RATE_SCHEDULE[1] agree on the ENTIRE FY2026/27 dataset', () => {
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
          Object.entries(rs.security.ordinaryFromAnnualised).map(([k, v]) => [String(Number(k)), v]),
        ),
      },
    });
    expect(project(fromDb)).toEqual(project(fromTs));
  });
});
