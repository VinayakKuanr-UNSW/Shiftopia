-- ============================================================================
-- EBA effective-dated TRAINEE wage schedule (Schedule 5) — audit follow-up
-- ----------------------------------------------------------------------------
-- Schedule 5 trainee wages are ABSOLUTE dollar figures (unlike apprentices and
-- SWS, which are percentages of an already-effective-dated base and so track
-- the cl 25.1 CPI + 0.5% uplift automatically). Held undated they go stale at
-- every 1 July increase. This table is the durable, effective-dated source of
-- truth, mirrored by the worker-safe engine copy
-- src/.../projections/utils/cost/trainee_matrix.ts (TRAINEE_RATE_SCHEDULE).
--
-- The whole Schedule 5 matrix is stored as one JSONB blob per effective_from
-- (the rates form a schooling-year × years-out matrix that does not fit flat
-- columns cleanly). rate-schedule-trainee-sync.test.ts asserts this seed equals
-- TRAINEE_RATE_SCHEDULE[0] — the same DB<->TS drift guard Schedule 2 has.
--
-- SAFETY: idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING), additive.
-- AUTHORED — NOT YET APPLIED to prod (apply via MCP apply_migration, not an
-- unreviewed db push). cl 25.3 (>= 2% above the AER Award) is a human check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."eba_trainee_schedule" (
    "effective_from" date NOT NULL,
    "matrix" jsonb NOT NULL,   -- mirrors TraineeRateMatrix (trainee_matrix.ts)
    "label" text,
    "source" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eba_trainee_schedule_pkey" PRIMARY KEY ("effective_from")
);

ALTER TABLE "public"."eba_trainee_schedule" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view EBA trainee rates" ON "public"."eba_trainee_schedule";
CREATE POLICY "Everyone can view EBA trainee rates" ON "public"."eba_trainee_schedule"
    FOR SELECT TO "authenticated" USING (true);

GRANT SELECT ON TABLE "public"."eba_trainee_schedule" TO "authenticated", "anon";
GRANT ALL    ON TABLE "public"."eba_trainee_schedule" TO "service_role";

-- ── Seed: EA 2025 commencement (mirrors TRAINEE_RATE_SCHEDULE[0]) ─────────────
-- NB: Wage Level A part-time hourly rates use the EA figures 21.10 / 24.55
-- (Schedule 5 cl 1.5.1); an earlier code copy had 21.11 / 25.14 (corrected).
INSERT INTO "public"."eba_trainee_schedule" ("effective_from","matrix","label","source")
VALUES (
  '2025-01-01',
  $json${
    "weeklyLevelA": {"10":[420.80,463.60,551.10,641.60,764.40,854.90],"11":[463.60,551.10,641.60,764.40,854.90,854.90],"12":[551.10,641.60,764.40,854.90,854.90,854.90]},
    "weeklyLevelB": {"10":[420.80,463.60,537.70,618.00,725.00,826.70],"11":[463.60,537.70,618.00,725.00,826.70,826.70],"12":[537.70,618.00,725.00,826.70,826.70,826.70]},
    "hourlyLevelA": {"10":[13.84,15.25,18.13,21.10,24.55,28.12],"11":[15.25,18.13,21.10,24.55,28.12,28.12],"12":[18.13,21.10,24.55,28.12,28.12,28.12]},
    "hourlyLevelB": {"10":[13.84,15.25,17.69,20.33,23.85,27.19],"11":[15.25,17.69,20.33,23.85,27.19,27.19],"12":[17.69,20.33,23.85,27.19,27.19,27.19]},
    "adult": {"ftWeekly":{"A":[887.50,920.70],"B":[858.40,890.60]},"ptHourly":{"A":[29.19,30.28],"B":[28.23,29.29]}},
    "schoolBasedHourly": {"yr12":15.25,"other":13.84},
    "certIvUpliftPct": 3.8
  }$json$::jsonb,
  'ICC Sydney EA 2025 — commencement (2025 vote)',
  'Schedule 5 §1.4–§1.5'
)
ON CONFLICT ("effective_from") DO NOTHING;
