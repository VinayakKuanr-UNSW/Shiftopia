-- ============================================================================
-- EBA effective-dated rate & allowance tables (audit Phase 2)
-- ----------------------------------------------------------------------------
-- ICC Sydney EA 2025 cl 25.1 mandates a CPI + 0.5% wage/allowance increase from
-- the first pay period on or after 1 July 2026, 2027 and 2028. Storing rates as
-- a flat, undated snapshot means every increase silently makes estimates stale
-- and historical shifts can never be re-priced at the rate that applied on their
-- own date. These tables are the durable, auditable, effective-dated source of
-- truth for wage rates and allowances.
--
-- RELATIONSHIP TO CODE: the worker-safe cost engine cannot read the DB per shift
-- (synchronous, no Supabase in the projection worker). It resolves rates from an
-- EMBEDDED copy — src/.../projections/utils/cost/rate-schedule.ts (RATE_SCHEDULE)
-- — which MUST mirror these tables. Until a generator makes this table the single
-- source (audit Phase 3), keep the two in sync when adding a new effective row.
--
-- SAFETY: this migration is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- and additive. It has been AUTHORED for review; apply it deliberately (do not
-- rely on an unreviewed `db push` — version drift has bitten this repo before).
-- cl 25.3 (rates must stay ≥ 2% above the Amusement, Events & Recreation Award)
-- is a human check when inserting a new effective_from row; it is not enforced
-- by a constraint here.
-- ============================================================================

-- ── eba_rate: per-classification hourly rates, effective-dated ───────────────
CREATE TABLE IF NOT EXISTS "public"."eba_rate" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "effective_from" date NOT NULL,
    "classification" text NOT NULL,          -- 'TRAINEE','LEVEL_1'..'LEVEL_7','SECURITY_LEVEL_3'..'6'
    "employment_basis" text NOT NULL,        -- 'permanent' | 'casual' | 'annualised'
    "ordinary_hourly_rate" numeric(8,2) NOT NULL,  -- de-loaded ordinary rate (Schedule 2 "Ordinary Hourly")
    "paid_hourly_rate" numeric(8,2) NOT NULL,      -- rate actually paid at ordinary time (casual incl. 25% loading)
    "source" text,                           -- provenance, e.g. 'EA2025 Schedule 2 §1'
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eba_rate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eba_rate_basis_check" CHECK ("employment_basis" = ANY (ARRAY['permanent'::text, 'casual'::text, 'annualised'::text])),
    CONSTRAINT "eba_rate_uniq" UNIQUE ("effective_from", "classification", "employment_basis")
);

CREATE INDEX IF NOT EXISTS "idx_eba_rate_lookup"
    ON "public"."eba_rate" USING btree ("classification", "employment_basis", "effective_from");

-- ── eba_allowance: allowance amounts, effective-dated (cl 28 / Sch 2 §3) ──────
CREATE TABLE IF NOT EXISTS "public"."eba_allowance" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "effective_from" date NOT NULL,
    "code" text NOT NULL,                    -- 'meal','first_aid_per_hour','protein_spill','split_shift'
    "amount" numeric(8,2) NOT NULL,
    "unit" text NOT NULL,                    -- 'per_occasion' | 'per_hour' | 'per_shift'
    "source" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "eba_allowance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eba_allowance_uniq" UNIQUE ("effective_from", "code")
);

CREATE INDEX IF NOT EXISTS "idx_eba_allowance_lookup"
    ON "public"."eba_allowance" USING btree ("code", "effective_from");

-- ── RLS: reference data — readable by any authenticated user, writable by admins
ALTER TABLE "public"."eba_rate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."eba_allowance" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can view EBA rates" ON "public"."eba_rate";
CREATE POLICY "Everyone can view EBA rates" ON "public"."eba_rate"
    FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "Everyone can view EBA allowances" ON "public"."eba_allowance";
CREATE POLICY "Everyone can view EBA allowances" ON "public"."eba_allowance"
    FOR SELECT TO "authenticated" USING (true);

-- Writes are service_role / admin only (no authenticated write policy = denied).
GRANT SELECT ON TABLE "public"."eba_rate" TO "authenticated", "anon";
GRANT ALL    ON TABLE "public"."eba_rate" TO "service_role";
GRANT SELECT ON TABLE "public"."eba_allowance" TO "authenticated", "anon";
GRANT ALL    ON TABLE "public"."eba_allowance" TO "service_role";

-- ── Seed: EA 2025 commencement (mirrors constants.ts / RATE_SCHEDULE[0]) ──────
-- Standard classifications. For casual rows: ordinary = the permanent (de-loaded)
-- rate, paid = the casual (loaded) rate — matching Schedule 2's columns.
INSERT INTO "public"."eba_rate"
    ("effective_from","classification","employment_basis","ordinary_hourly_rate","paid_hourly_rate","source")
VALUES
    ('2025-01-01','TRAINEE','permanent',24.96,24.96,'EA2025 Schedule 2 §1'),
    ('2025-01-01','TRAINEE','casual',   24.96,31.20,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_1','permanent',25.65,25.65,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_1','casual',   25.65,32.06,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_2','permanent',26.37,26.37,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_2','casual',   26.37,32.96,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_3','permanent',27.23,27.23,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_3','casual',   27.23,34.04,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_4','permanent',28.79,28.79,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_4','casual',   28.79,35.99,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_5','permanent',30.82,30.82,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_5','casual',   30.82,38.52,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_6','permanent',32.82,32.82,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_6','casual',   32.82,41.03,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_7','permanent',34.19,34.19,'EA2025 Schedule 2 §1'),
    ('2025-01-01','LEVEL_7','casual',   34.19,42.74,'EA2025 Schedule 2 §1'),
    -- Full-time security annualised rates (Schedule 2 §2): paid = annualised hourly,
    -- ordinary = equivalent ordinary rate used for overtime/penalty maths.
    ('2025-01-01','SECURITY_LEVEL_3','annualised',27.23,32.20,'EA2025 Schedule 2 §2'),
    ('2025-01-01','SECURITY_LEVEL_4','annualised',28.79,34.63,'EA2025 Schedule 2 §2'),
    ('2025-01-01','SECURITY_LEVEL_5','annualised',30.82,37.06,'EA2025 Schedule 2 §2'),
    ('2025-01-01','SECURITY_LEVEL_6','annualised',32.82,39.48,'EA2025 Schedule 2 §2')
ON CONFLICT ("effective_from","classification","employment_basis") DO NOTHING;

INSERT INTO "public"."eba_allowance"
    ("effective_from","code","amount","unit","source")
VALUES
    ('2025-01-01','meal',              13.61,'per_occasion','EA2025 cl 28.1 / Sch 2 §3'),
    ('2025-01-01','first_aid_per_hour', 0.56,'per_hour',    'EA2025 cl 28.2 / Sch 2 §3'),
    ('2025-01-01','protein_spill',      7.17,'per_shift',   'EA2025 cl 28.3 / Sch 2 §3'),
    ('2025-01-01','split_shift',       11.13,'per_shift',   'EA2025 cl 28.4 / Sch 2 §3')
ON CONFLICT ("effective_from","code") DO NOTHING;

-- When ABS publishes the March-2026 Sydney All-Groups CPI, add the 1 Jul 2026
-- rows here (effective_from = '2026-07-01', each value × (1 + (CPI% + 0.5)/100),
-- rounded to cents) AND mirror them into RATE_SCHEDULE via applyCpiIncrease().
