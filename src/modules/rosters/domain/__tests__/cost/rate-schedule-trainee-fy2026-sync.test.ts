/**
 * rate-schedule-trainee-fy2026-sync.test.ts — FY26/27 trainee DB ⇄ TS guard
 * ────────────────────────────────────────────────────────────────────────────
 * The +5.1% FY26/27 Schedule 5 trainee matrix (effective 6 Jul 2026) exists in
 * two copies:
 *   1. DB seed: supabase/migrations/20260712000000_eba_rate_fy2026.sql
 *      (the 2026-07-06 row of public.eba_trainee_schedule.matrix JSONB).
 *   2. Worker-safe engine copy: trainee_matrix.ts → TRAINEE_RATE_SCHEDULE[1].
 *
 * Unlike Schedule 2, no official Schedule 5 FY26/27 table was published, so both
 * copies are DERIVED at ×1.051 — this guard ensures the (hand-entered) DB JSONB
 * and the (hand-entered) TS literal stay identical to the cent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  TRAINEE_RATE_SCHEDULE,
  type TraineeRateMatrix,
} from '../../projections/utils/cost/trainee_matrix';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../../../supabase/migrations/20260712000100_eba_trainee_schedule_fy2026.sql',
);

/** Pull the single dollar-quoted JSON matrix out of the FY26 migration. */
function matrixFromMigration(): TraineeRateMatrix {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const m = sql.match(/\$json\$([\s\S]*?)\$json\$/);
  if (!m) throw new Error('could not find $json$…$json$ matrix literal in FY26 migration');
  return JSON.parse(m[1]) as TraineeRateMatrix;
}

function matrixOf(set: (typeof TRAINEE_RATE_SCHEDULE)[number]): TraineeRateMatrix {
  const { effectiveFrom: _e, label: _l, source: _s, ...matrix } = set;
  return matrix;
}

describe('trainee-schedule sync — FY26/27 eba_trainee_schedule ⇄ TRAINEE_RATE_SCHEDULE[1]', () => {
  it('the FY26 set is effective from 2026-07-06', () => {
    expect(TRAINEE_RATE_SCHEDULE[1].effectiveFrom).toBe('2026-07-06');
  });

  it('the seeded JSONB matrix equals the embedded FY26 matrix exactly', () => {
    expect(matrixFromMigration()).toEqual(matrixOf(TRAINEE_RATE_SCHEDULE[1]));
  });

  it('applies +5.1% to a representative cell (25.80 = 24.55 × 1.051)', () => {
    // Wage Level A part-time hourly, Year 10, +3 yrs out: 24.55 → 25.80.
    expect(TRAINEE_RATE_SCHEDULE[1].hourlyLevelA[10][4]).toBe(25.80);
  });
});
