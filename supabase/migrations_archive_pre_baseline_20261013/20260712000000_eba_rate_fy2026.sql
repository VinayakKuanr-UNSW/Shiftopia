-- ============================================================================
-- EBA FY2026/2027 rate/allowance increase (+5.1%, effective 6 Jul 2026)
-- ----------------------------------------------------------------------------
-- The FY26/27 EBA variation raises ALL wage rates and allowances by 5.1% from
-- the first pay period on or after 6 July 2026. This migration adds the new
-- effective-dated Schedule 2 rows to public.eba_rate / public.eba_allowance
-- (created by 20260710162809 / file 20260709000000).
--
-- The Schedule 5 trainee FY26/27 row lives in the sibling migration
-- 20260712000100_eba_trainee_schedule_fy2026.sql, which depends on the
-- eba_trainee_schedule table (20260711120000) — kept together so the trainee
-- DB mirror stays a single deferred unit while these Schedule 2 rows (the base
-- pay rates the admin Overview reads) ship on their own.
--
-- VALUES: TRANSCRIBED FROM THE PUBLISHED FY26/27 EBA tables — NOT computed as
-- base × 1.051 (a naive multiply diverges by a cent in several casual/security/
-- protein cells; the annualised rates are published as annual salary ÷ annual
-- hours). Mirrors RATE_SCHEDULE[1] in the worker-safe engine copy
-- (rate-schedule.ts); rate-schedule-fy2026-sync.test.ts asserts they are equal.
--
-- SAFETY: idempotent (ON CONFLICT DO NOTHING), additive. cl 25.3 (rates must
-- stay >= 2% above the Amusement, Events & Recreation Award) is a human check.
-- ============================================================================

-- ── Schedule 2 §1: standard classifications (+5.1%, published FY26/27) ─────────
-- For casual rows: ordinary = the permanent (de-loaded) rate, paid = the casual
-- (loaded) rate — matching Schedule 2's columns.
INSERT INTO "public"."eba_rate"
    ("effective_from","classification","employment_basis","ordinary_hourly_rate","paid_hourly_rate","source")
VALUES
    ('2026-07-06','TRAINEE','permanent',26.23,26.23,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','TRAINEE','casual',   26.23,32.79,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_1','permanent',26.96,26.96,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_1','casual',   26.96,33.70,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_2','permanent',27.71,27.71,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_2','casual',   27.71,34.64,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_3','permanent',28.62,28.62,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_3','casual',   28.62,35.77,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_4','permanent',30.26,30.26,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_4','casual',   30.26,37.82,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_5','permanent',32.39,32.39,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_5','casual',   32.39,40.49,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_6','permanent',34.49,34.49,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_6','casual',   34.49,43.12,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_7','permanent',35.93,35.93,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    ('2026-07-06','LEVEL_7','casual',   35.93,44.92,'EA FY2026/27 Schedule 2 §1 (+5.1%)'),
    -- Schedule 2 §2: full-time security annualised (paid = annualised hourly,
    -- ordinary = equivalent ordinary rate for overtime/penalty maths).
    ('2026-07-06','SECURITY_LEVEL_3','annualised',28.62,33.84,'EA FY2026/27 Schedule 2 §2 (+5.1%)'),
    ('2026-07-06','SECURITY_LEVEL_4','annualised',30.26,36.39,'EA FY2026/27 Schedule 2 §2 (+5.1%)'),
    ('2026-07-06','SECURITY_LEVEL_5','annualised',32.39,38.95,'EA FY2026/27 Schedule 2 §2 (+5.1%)'),
    ('2026-07-06','SECURITY_LEVEL_6','annualised',34.49,41.49,'EA FY2026/27 Schedule 2 §2 (+5.1%)')
ON CONFLICT ("effective_from","classification","employment_basis") DO NOTHING;

-- ── Schedule 2 §3: allowances (+5.1%, published FY26/27) ──────────────────────
INSERT INTO "public"."eba_allowance"
    ("effective_from","code","amount","unit","source")
VALUES
    ('2026-07-06','meal',              14.30,'per_occasion','EA FY2026/27 cl 28.1 / Sch 2 §3 (+5.1%)'),
    ('2026-07-06','first_aid_per_hour', 0.59,'per_hour',    'EA FY2026/27 cl 28.2 / Sch 2 §3 (+5.1%)'),
    ('2026-07-06','protein_spill',      7.53,'per_shift',   'EA FY2026/27 cl 28.3 / Sch 2 §3 (+5.1%)'),
    ('2026-07-06','split_shift',       11.70,'per_shift',   'EA FY2026/27 cl 28.4 / Sch 2 §3 (+5.1%)')
ON CONFLICT ("effective_from","code") DO NOTHING;
