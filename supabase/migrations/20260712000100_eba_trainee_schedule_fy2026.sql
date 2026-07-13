-- ============================================================================
-- EBA FY2026/2027 TRAINEE schedule increase (+5.1%, effective 6 Jul 2026)
-- ----------------------------------------------------------------------------
-- Adds the Schedule 5 trainee FY26/27 matrix row to public.eba_trainee_schedule
-- (created + seeded for 2025 by 20260711120000). Kept SEPARATE from the Schedule
-- 2 FY26 migration (20260712000000) because the trainee table itself is a
-- deferred unit: 20260711120000 is authored-not-applied, so this row can only
-- land after it does. Until then the admin UI's trainee tab reads the embedded
-- TRAINEE_RATE_SCHEDULE (which already carries FY26) via its fallback path.
--
-- VALUES: no official Schedule 5 FY26/27 table was published (only Schedule 2),
-- so the matrix is DERIVED at ×1.051 (each 2025 cell rounded to cents). Mirrors
-- TRAINEE_RATE_SCHEDULE[1] in trainee_matrix.ts;
-- rate-schedule-trainee-fy2026-sync.test.ts asserts the two are identical.
--
-- SAFETY: idempotent (ON CONFLICT DO NOTHING), additive. AUTHORED — NOT YET
-- APPLIED (apply 20260711120000 first, then this).
-- ============================================================================

INSERT INTO "public"."eba_trainee_schedule" ("effective_from","matrix","label","source")
VALUES (
  '2026-07-06',
  $json${
    "weeklyLevelA": {"10":[442.26,487.24,579.21,674.32,803.38,898.5],"11":[487.24,579.21,674.32,803.38,898.5,898.5],"12":[579.21,674.32,803.38,898.5,898.5,898.5]},
    "weeklyLevelB": {"10":[442.26,487.24,565.12,649.52,761.97,868.86],"11":[487.24,565.12,649.52,761.97,868.86,868.86],"12":[565.12,649.52,761.97,868.86,868.86,868.86]},
    "hourlyLevelA": {"10":[14.55,16.03,19.05,22.18,25.8,29.55],"11":[16.03,19.05,22.18,25.8,29.55,29.55],"12":[19.05,22.18,25.8,29.55,29.55,29.55]},
    "hourlyLevelB": {"10":[14.55,16.03,18.59,21.37,25.07,28.58],"11":[16.03,18.59,21.37,25.07,28.58,28.58],"12":[18.59,21.37,25.07,28.58,28.58,28.58]},
    "adult": {"ftWeekly":{"A":[932.76,967.66],"B":[902.18,936.02]},"ptHourly":{"A":[30.68,31.82],"B":[29.67,30.78]}},
    "schoolBasedHourly": {"yr12":16.03,"other":14.55},
    "certIvUpliftPct": 3.8
  }$json$::jsonb,
  'ICC Sydney EA — FY2026/2027 (5.1% increase)',
  '+5.1% (x1.051) applied to Schedule 5 §1.4-§1.5 (2025 baseline)'
)
ON CONFLICT ("effective_from") DO NOTHING;
