/**
 * rate-schedule-trainee-sync.test.ts — DB migration ⇄ TS trainee schedule guard
 * ────────────────────────────────────────────────────────────────────────────
 * There are two copies of the Schedule 5 trainee wage matrix:
 *   1. The DB migration (durable source of truth):
 *      supabase/migrations/20260711120000_eba_trainee_schedule.sql
 *      (seeds public.eba_trainee_schedule.matrix as JSONB).
 *   2. The static, worker-safe engine copy:
 *      trainee_matrix.ts → TRAINEE_RATE_SCHEDULE[0].
 *
 * The projection worker has no Supabase access, so copy #2 must stay a static
 * in-code copy. This test extracts the seeded JSONB straight out of the
 * migration and asserts it EXACTLY equals the matrix fields of
 * TRAINEE_RATE_SCHEDULE[0]. Any divergence fails the build — the same guard
 * rate-schedule-sync.test.ts gives Schedule 2.
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
  '../../../../../../supabase/migrations/20260711120000_eba_trainee_schedule.sql',
);

/** Pull the single dollar-quoted JSON matrix out of the migration and parse it. */
function matrixFromMigration(): TraineeRateMatrix {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const m = sql.match(/\$json\$([\s\S]*?)\$json\$/);
  if (!m) throw new Error('could not find $json$…$json$ matrix literal in migration');
  return JSON.parse(m[1]) as TraineeRateMatrix;
}

/** Strip the effective-dating metadata to compare only the rate matrix. */
function matrixOf(set: (typeof TRAINEE_RATE_SCHEDULE)[number]): TraineeRateMatrix {
  const { effectiveFrom: _e, label: _l, source: _s, ...matrix } = set;
  return matrix;
}

describe('trainee-schedule sync — eba_trainee_schedule ⇄ TRAINEE_RATE_SCHEDULE[0]', () => {
  it('the seeded JSONB matrix equals the embedded 2025 baseline exactly', () => {
    expect(matrixFromMigration()).toEqual(matrixOf(TRAINEE_RATE_SCHEDULE[0]));
  });

  it('the 2025 baseline is effective from 2025-01-01', () => {
    expect(TRAINEE_RATE_SCHEDULE[0].effectiveFrom).toBe('2025-01-01');
  });

  it('carries the corrected EA Wage Level A part-time hourly rates (21.10 / 24.55)', () => {
    // Regression guard for the 21.11 / 25.14 typo the flat copy had.
    expect(TRAINEE_RATE_SCHEDULE[0].hourlyLevelA[10]).toEqual([13.84, 15.25, 18.13, 21.10, 24.55, 28.12]);
  });
});
