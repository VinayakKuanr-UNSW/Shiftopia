-- =============================================================================
-- Migration: gross_pay_records — persistence for the GROSS-pay engine
-- File:      20260709100000_gross_pay_records.sql
-- Status:    APPLIED TO PROD 2026-07-11 via MCP apply_migration (name: gross_pay_records).
--
-- This is a live production DB and the repo has been bitten by blind
-- `supabase db push` / migration-version drift before (see MEMORY). This file
-- is written to be reviewed and applied deliberately by a human via the
-- controlled migration path — it is NOT run by any tooling here and MUST NOT be
-- `db push`ed. It is designed to be idempotent + additive + reversible so a
-- careful re-run is safe.
--
-- SCOPE BOUNDARY — GROSS pay ONLY.
--   This table persists the itemised GROSS-earnings hand-off record produced by
--   `src/modules/payroll` (the `PeriodGrossPay` shape). It stores gross_pay,
--   paid_hours, shift_count and the itemised EarningsLine[] per employee per
--   pay period. PAYG withholding, superannuation guarantee, STP reporting and
--   net-pay disbursement are DELIBERATELY OUT OF SCOPE and belong to a certified
--   payroll provider. Do NOT add tax/super/net columns here.
--
-- Dormant tables this migration gives a writer to (schema already in baseline
-- 20251015000000_baseline_schema.sql, no app reader/writer until now):
--   - public.pay_periods           (period bounds + open|locked|paid status)
--   - public.shift_payroll_records (per-shift actuals + export status)
--   This migration does NOT alter those tables; it only references pay_periods
--   via FK. The write API (src/modules/payroll/data/grossPay.write.api.ts) is
--   what actually writes shift_payroll_records / pay_periods.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Table: public.gross_pay_records
--   One row per (pay_period_id, employee_id): the persisted PeriodGrossPay.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."gross_pay_records" (
    "id"                  "uuid"        DEFAULT "gen_random_uuid"() NOT NULL,
    -- Pay period this record belongs to. FK to the dormant pay_periods table.
    "pay_period_id"       "uuid"        NOT NULL,
    -- Employee the gross pay was computed for (profiles.id == auth.users.id).
    "employee_id"         "uuid"        NOT NULL,
    -- Denormalised period bounds (inclusive) so a record is self-describing even
    -- if the parent pay_periods row is later re-dated. Mirror PeriodGrossPay.
    "period_start_date"   "date"        NOT NULL,
    "period_end_date"     "date"        NOT NULL,
    -- Aggregated gross-pay totals (whole cents; engine rounds to cents already).
    "gross_pay"           numeric(12,2) NOT NULL DEFAULT 0,
    "paid_hours"          numeric(8,2)  NOT NULL DEFAULT 0,
    "shift_count"         integer       NOT NULL DEFAULT 0,
    -- Itemised EarningsLine[] aggregated by code, canonical order:
    -- [{ code, description, hours?, amount }]. This is the payslip breakdown.
    "lines"               "jsonb"       NOT NULL DEFAULT '[]'::"jsonb",
    -- Lifecycle of THIS gross-pay record (independent of pay_periods.status):
    --   draft   = recomputed, not yet approved for hand-off
    --   final   = approved / frozen for the payroll provider hand-off
    --   void    = superseded / retracted
    "status"              "text"        NOT NULL DEFAULT 'draft',
    -- How this record was produced (engine run vs manual import/adjustment).
    "source"              "text"        NOT NULL DEFAULT 'engine',
    -- Optional provenance: which shift_payroll_records rows fed this aggregate.
    -- Kept simple: a flat array of shift_payroll_records.id (or shift_id) uuids.
    "source_shift_payroll_record_ids" "uuid"[] NOT NULL DEFAULT '{}'::"uuid"[],
    "computed_at"         timestamp with time zone NOT NULL DEFAULT "now"(),
    "computed_by"         "uuid",
    "created_at"          timestamp with time zone NOT NULL DEFAULT "now"(),
    "updated_at"          timestamp with time zone NOT NULL DEFAULT "now"(),
    CONSTRAINT "gross_pay_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gross_pay_records_status_check"
        CHECK (("status" = ANY (ARRAY['draft'::"text", 'final'::"text", 'void'::"text"]))),
    CONSTRAINT "gross_pay_records_source_check"
        CHECK (("source" = ANY (ARRAY['engine'::"text", 'manual'::"text", 'import'::"text"]))),
    -- One gross-pay record per employee per pay period (upsert conflict target).
    CONSTRAINT "gross_pay_records_period_employee_key" UNIQUE ("pay_period_id", "employee_id")
);

ALTER TABLE "public"."gross_pay_records" OWNER TO "postgres";

COMMENT ON TABLE "public"."gross_pay_records" IS
    'GROSS-pay hand-off: one persisted PeriodGrossPay per (pay_period_id, employee_id). '
    'gross_pay/paid_hours/shift_count + itemised EarningsLine[] in lines jsonb. '
    'GROSS only — tax/super/STP/net are out of scope. Written by '
    'src/modules/payroll/data/grossPay.write.api.ts.';

-- Foreign keys. Guarded so re-running the migration does not error on a re-add.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'gross_pay_records_pay_period_id_fkey'
    ) THEN
        ALTER TABLE ONLY "public"."gross_pay_records"
            ADD CONSTRAINT "gross_pay_records_pay_period_id_fkey"
            FOREIGN KEY ("pay_period_id")
            REFERENCES "public"."pay_periods"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'gross_pay_records_employee_id_fkey'
    ) THEN
        ALTER TABLE ONLY "public"."gross_pay_records"
            ADD CONSTRAINT "gross_pay_records_employee_id_fkey"
            FOREIGN KEY ("employee_id")
            REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'gross_pay_records_computed_by_fkey'
    ) THEN
        ALTER TABLE ONLY "public"."gross_pay_records"
            ADD CONSTRAINT "gross_pay_records_computed_by_fkey"
            FOREIGN KEY ("computed_by")
            REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
    END IF;
END
$$;

-- Indexes (idempotent).
CREATE INDEX IF NOT EXISTS "idx_gross_pay_records_pay_period"
    ON "public"."gross_pay_records" USING "btree" ("pay_period_id");
CREATE INDEX IF NOT EXISTS "idx_gross_pay_records_employee"
    ON "public"."gross_pay_records" USING "btree" ("employee_id");
CREATE INDEX IF NOT EXISTS "idx_gross_pay_records_dates"
    ON "public"."gross_pay_records" USING "btree" ("period_start_date", "period_end_date");
CREATE INDEX IF NOT EXISTS "idx_gross_pay_records_status"
    ON "public"."gross_pay_records" USING "btree" ("status");

-- Keep updated_at fresh. Reuses the shared public.touch_updated_at() trigger fn
-- already defined in the baseline (used by shift_payroll_records etc.).
DROP TRIGGER IF EXISTS "trg_gross_pay_records_updated_at" ON "public"."gross_pay_records";
CREATE TRIGGER "trg_gross_pay_records_updated_at"
    BEFORE UPDATE ON "public"."gross_pay_records"
    FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();

-- -----------------------------------------------------------------------------
-- Row Level Security
--   SELECT: authenticated users may read. This is intentionally a permissive
--           `authenticated` read, NOT org-scoped — see the NOTE below.
--   WRITE (INSERT/UPDATE/DELETE): service_role only — the write API is expected
--           to run privileged (edge function / server) for payroll persistence,
--           matching `payroll_records_insert` / `payroll_records_update`.
--
-- READ SCOPING (owner-only — the safe default):
--   An employee may read ONLY their OWN gross-pay records (`employee_id =
--   auth.uid()`; profiles.id == auth.users.id). This is the conservative,
--   correct-by-construction default for sensitive earnings data — nobody sees
--   another person's pay through the browser. It deliberately does NOT try to
--   grant managers cross-employee read: the obvious "scope by employee's org"
--   join would need `profiles.organization_id` (which DOES NOT EXIST — only the
--   DEPRECATED `legacy_organization_id`), and `is_manager_or_above()` is broken
--   in prod (see MEMORY). Manager / payroll-team access to OTHER employees'
--   records goes through the privileged service_role path (edge/server), same as
--   the writes. A proper manager-scoped authenticated SELECT can be ADDED later
--   via the canonical org source (user_contracts) without weakening this owner
--   rule. Note: the live payslip UI computes from shifts/timesheets directly, so
--   owner-only read here does not restrict that surface.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."gross_pay_records" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gross_pay_records_select" ON "public"."gross_pay_records";
CREATE POLICY "gross_pay_records_select" ON "public"."gross_pay_records"
    FOR SELECT TO "authenticated"
    USING ("employee_id" = ( SELECT "auth"."uid"() ));

DROP POLICY IF EXISTS "gross_pay_records_insert" ON "public"."gross_pay_records";
CREATE POLICY "gross_pay_records_insert" ON "public"."gross_pay_records"
    FOR INSERT TO "authenticated", "service_role"
    WITH CHECK (( SELECT "auth"."role"() AS "role") = 'service_role'::"text");

DROP POLICY IF EXISTS "gross_pay_records_update" ON "public"."gross_pay_records";
CREATE POLICY "gross_pay_records_update" ON "public"."gross_pay_records"
    FOR UPDATE TO "authenticated", "service_role"
    USING (( SELECT "auth"."role"() AS "role") = 'service_role'::"text")
    WITH CHECK (( SELECT "auth"."role"() AS "role") = 'service_role'::"text");

DROP POLICY IF EXISTS "gross_pay_records_delete" ON "public"."gross_pay_records";
CREATE POLICY "gross_pay_records_delete" ON "public"."gross_pay_records"
    FOR DELETE TO "authenticated", "service_role"
    USING (( SELECT "auth"."role"() AS "role") = 'service_role'::"text");

-- Table grants — mirror the baseline pattern for payroll tables.
GRANT ALL ON TABLE "public"."gross_pay_records" TO "anon";
GRANT ALL ON TABLE "public"."gross_pay_records" TO "authenticated";
GRANT ALL ON TABLE "public"."gross_pay_records" TO "service_role";

-- NOTE ON WRITE PATH: INSERT/UPDATE/DELETE require service_role. If the
-- gross-pay persistence is ever run from the browser under the anon/authenticated
-- key (not a service_role/edge context), these writes WILL be denied by RLS and
-- the write API will surface the Postgres error. That is intentional: payroll
-- writes should be privileged. If a manager-scoped authenticated write is later
-- required, add a policy here mirroring the org/certificate pattern used
-- elsewhere in the baseline (via user_contracts, the canonical org source).

COMMIT;

-- =============================================================================
-- END — APPLIED TO PROD 2026-07-11. Do not `supabase db push` this file. Apply via
-- the reviewed migration path only.
-- =============================================================================
