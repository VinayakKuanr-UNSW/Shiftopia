-- ============================================================================
-- public_holidays — shared jurisdiction calendar  (audit F-21, enables F-04)
-- ============================================================================
--
-- PROBLEM
--   The fairness ledger classified public holidays against a hardcoded literal
--   in `src/modules/rosters/domain/fairness-ledger.ts`:
--
--       const AU_PUBLIC_HOLIDAYS_2026 = new Set([ '2026-01-01', ... ]);
--       // "In production this would come from a Supabase lookup."
--
--   Three problems: (1) it covers 2026 ONLY, so from 2027-01-01 every date
--   silently classifies as "not a holiday" and the public_holiday_shifts metric
--   reads 0 forever with no error; (2) it disagrees with
--   `src/modules/core/lib/holidays.ts` (the `date-holidays` AU-NSW instance the
--   compliance and payroll engines use), so a shift could be a public holiday
--   for pay but not for fairness; (3) it is NSW-only while the schema is
--   multi-org, and `organizations` has no jurisdiction column.
--
--   It also blocked moving the ledger recompute server-side (audit F-04): SQL
--   has no holiday calendar, so a PL/pgSQL recompute had nothing to classify
--   against.
--
-- FIX
--   One table, keyed by jurisdiction, as the shared source of truth for SQL and
--   TS alike. Seeded 2024-2032 from the app's OWN `date-holidays` AU-NSW
--   instance (generated, not hand-typed) so the two can't diverge on day one.
--
--   Only `type === 'public'` entries are included — bank/observance/optional
--   days are excluded, matching `getPublicHolidayEntry()` in holidays.ts.
--
-- FOLLOW-UP (not in this migration)
--   - Point `classifyShift` at this table so TS and SQL share one calendar.
--   - Add `organizations.jurisdiction` and stop assuming AU-NSW.
--   - Extend the seed beyond 2032 (a coverage check is provided below).
-- ============================================================================

-- ── Reconcile a PRE-EXISTING legacy table ───────────────────────────────────
--
-- `public_holidays` already exists in production, created by the Oct-2025
-- baseline schema with a DIFFERENT shape:
--
--     id uuid PK · holiday_date · holiday_name NOT NULL
--     applies_to_state (default 'NSW') · is_national · created_at
--
-- There is no `jurisdiction` column. A bare `CREATE TABLE IF NOT EXISTS` would
-- therefore silently no-op against production and leave every downstream
-- `JOIN ... ON ph.jurisdiction = ...` referencing a column that does not exist
-- — breaking recompute_fairness_ledger, jurisdiction_is_known() and the
-- organizations.jurisdiction CHECK, all at apply time or worse at run time.
--
-- Validating against a throwaway container could not catch this: the fixture
-- had no `public_holidays`, so IF NOT EXISTS created the NEW shape and
-- everything passed. The baseline in the container was not the baseline in
-- production. (Same lesson as the 2026-08-02 migration reconciliation: verify
-- against what prod actually has, not against what the repo implies.)
--
-- The legacy table is dormant — zero functions and zero client queries read it
-- — and incomplete: production is missing Anzac Day 2026-04-25, both Labour
-- Days, both Easter Sundays and Boxing Day 2026-12-26. The seed below is
-- authoritative and fills those gaps.
--
-- Non-destructive: legacy columns are kept and back-filled, never dropped.

DO $$
BEGIN
    IF to_regclass('public.public_holidays') IS NULL THEN
        CREATE TABLE public.public_holidays (
            holiday_date date NOT NULL,
            jurisdiction text NOT NULL DEFAULT 'AU-NSW',
            name         text NOT NULL,
            created_at   timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT public_holidays_pkey PRIMARY KEY (holiday_date, jurisdiction)
        );
        RETURN;
    END IF;

    -- Canonical jurisdiction key, derived from the legacy state code.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='public_holidays'
                      AND column_name='jurisdiction') THEN
        ALTER TABLE public.public_holidays
            ADD COLUMN jurisdiction text NOT NULL DEFAULT 'AU-NSW';

        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='public_holidays'
                      AND column_name='applies_to_state') THEN
            UPDATE public.public_holidays
               SET jurisdiction = 'AU-' || upper(applies_to_state)
             WHERE applies_to_state IS NOT NULL;
        END IF;
    END IF;

    -- Canonical name, derived from the legacy one.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='public_holidays'
                      AND column_name='name') THEN
        ALTER TABLE public.public_holidays ADD COLUMN name text;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='public_holidays'
                      AND column_name='holiday_name') THEN
            UPDATE public.public_holidays SET name = holiday_name WHERE name IS NULL;
        END IF;
    END IF;

    -- The seed writes only the canonical columns, so a legacy NOT NULL on
    -- holiday_name would reject every new row. Relaxed, then kept coherent by
    -- the back-fill at the end of this migration.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='public_holidays'
                  AND column_name='holiday_name' AND is_nullable='NO') THEN
        ALTER TABLE public.public_holidays ALTER COLUMN holiday_name DROP NOT NULL;
    END IF;

    -- ON CONFLICT (holiday_date, jurisdiction) needs a matching unique index.
    -- The legacy PK is on `id`, so add a constraint rather than re-keying.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'public_holidays_date_jurisdiction_key') THEN
        ALTER TABLE public.public_holidays
            ADD CONSTRAINT public_holidays_date_jurisdiction_key
            UNIQUE (holiday_date, jurisdiction);
    END IF;
END $$;

-- `name` must be populated for every row before it can be enforced NOT NULL;
-- the seed below guarantees that for seeded dates, and the back-fill above for
-- pre-existing ones. Enforced at the end of this migration.

ALTER TABLE public.public_holidays OWNER TO postgres;

COMMENT ON TABLE public.public_holidays IS
    'Shared public-holiday calendar keyed by jurisdiction. Source of truth for the SQL fairness-ledger recompute and (once wired) the TS classifier. Seeded from the date-holidays AU-NSW instance in src/modules/core/lib/holidays.ts.';

-- Read-only reference data: every authenticated user may read it; nobody but
-- service_role may write. (Postgres auto-grants EXECUTE/SELECT to PUBLIC, which
-- `anon` inherits — the REVOKE is required, not decorative.)
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_holidays_read_all ON public.public_holidays;
CREATE POLICY public_holidays_read_all
    ON public.public_holidays FOR SELECT TO authenticated
    USING (true);

REVOKE ALL ON TABLE public.public_holidays FROM PUBLIC;
REVOKE ALL ON TABLE public.public_holidays FROM anon;
GRANT SELECT ON TABLE public.public_holidays TO authenticated;
GRANT ALL    ON TABLE public.public_holidays TO service_role;

-- ── Seed: AU-NSW 2024-2032 ──────────────────────────────────────────────────
-- Generated from `new Holidays('AU','NSW').getHolidays(y)` filtered to
-- type === 'public'. Idempotent: re-running updates names, never duplicates.

INSERT INTO public.public_holidays (holiday_date, jurisdiction, name) VALUES
    ('2024-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2024-01-26', 'AU-NSW', 'Australia Day'),
    ('2024-03-29', 'AU-NSW', 'Good Friday'),
    ('2024-03-30', 'AU-NSW', 'Easter Saturday'),
    ('2024-03-31', 'AU-NSW', 'Easter Sunday'),
    ('2024-04-01', 'AU-NSW', 'Easter Monday'),
    ('2024-04-25', 'AU-NSW', 'Anzac Day'),
    ('2024-06-10', 'AU-NSW', 'King''s Birthday'),
    ('2024-10-07', 'AU-NSW', 'Labour Day'),
    ('2024-12-25', 'AU-NSW', 'Christmas Day'),
    ('2024-12-26', 'AU-NSW', 'Boxing Day'),
    ('2025-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2025-01-27', 'AU-NSW', 'Australia Day'),
    ('2025-04-18', 'AU-NSW', 'Good Friday'),
    ('2025-04-19', 'AU-NSW', 'Easter Saturday'),
    ('2025-04-20', 'AU-NSW', 'Easter Sunday'),
    ('2025-04-21', 'AU-NSW', 'Easter Monday'),
    ('2025-04-25', 'AU-NSW', 'Anzac Day'),
    ('2025-06-09', 'AU-NSW', 'King''s Birthday'),
    ('2025-10-06', 'AU-NSW', 'Labour Day'),
    ('2025-12-25', 'AU-NSW', 'Christmas Day'),
    ('2025-12-26', 'AU-NSW', 'Boxing Day'),
    ('2026-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2026-01-26', 'AU-NSW', 'Australia Day'),
    ('2026-04-03', 'AU-NSW', 'Good Friday'),
    ('2026-04-04', 'AU-NSW', 'Easter Saturday'),
    ('2026-04-05', 'AU-NSW', 'Easter Sunday'),
    ('2026-04-06', 'AU-NSW', 'Easter Monday'),
    ('2026-04-25', 'AU-NSW', 'Anzac Day'),
    ('2026-04-27', 'AU-NSW', 'Anzac Day (substitute day)'),
    ('2026-06-08', 'AU-NSW', 'King''s Birthday'),
    ('2026-10-05', 'AU-NSW', 'Labour Day'),
    ('2026-12-25', 'AU-NSW', 'Christmas Day'),
    ('2026-12-26', 'AU-NSW', 'Boxing Day'),
    ('2026-12-28', 'AU-NSW', 'Boxing Day (substitute day)'),
    ('2027-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2027-01-26', 'AU-NSW', 'Australia Day'),
    ('2027-03-26', 'AU-NSW', 'Good Friday'),
    ('2027-03-27', 'AU-NSW', 'Easter Saturday'),
    ('2027-03-28', 'AU-NSW', 'Easter Sunday'),
    ('2027-03-29', 'AU-NSW', 'Easter Monday'),
    ('2027-04-25', 'AU-NSW', 'Anzac Day'),
    ('2027-04-26', 'AU-NSW', 'Anzac Day (substitute day)'),
    ('2027-06-14', 'AU-NSW', 'King''s Birthday'),
    ('2027-10-04', 'AU-NSW', 'Labour Day'),
    ('2027-12-25', 'AU-NSW', 'Christmas Day'),
    ('2027-12-26', 'AU-NSW', 'Boxing Day'),
    ('2027-12-27', 'AU-NSW', 'Christmas Day (substitute day)'),
    ('2027-12-28', 'AU-NSW', 'Boxing Day (substitute day)'),
    ('2028-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2028-01-03', 'AU-NSW', 'New Year''s Day'),
    ('2028-01-26', 'AU-NSW', 'Australia Day'),
    ('2028-04-14', 'AU-NSW', 'Good Friday'),
    ('2028-04-15', 'AU-NSW', 'Easter Saturday'),
    ('2028-04-16', 'AU-NSW', 'Easter Sunday'),
    ('2028-04-17', 'AU-NSW', 'Easter Monday'),
    ('2028-04-25', 'AU-NSW', 'Anzac Day'),
    ('2028-06-12', 'AU-NSW', 'King''s Birthday'),
    ('2028-10-02', 'AU-NSW', 'Labour Day'),
    ('2028-12-25', 'AU-NSW', 'Christmas Day'),
    ('2028-12-26', 'AU-NSW', 'Boxing Day'),
    ('2029-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2029-01-26', 'AU-NSW', 'Australia Day'),
    ('2029-03-30', 'AU-NSW', 'Good Friday'),
    ('2029-03-31', 'AU-NSW', 'Easter Saturday'),
    ('2029-04-01', 'AU-NSW', 'Easter Sunday'),
    ('2029-04-02', 'AU-NSW', 'Easter Monday'),
    ('2029-04-25', 'AU-NSW', 'Anzac Day'),
    ('2029-06-11', 'AU-NSW', 'King''s Birthday'),
    ('2029-10-01', 'AU-NSW', 'Labour Day'),
    ('2029-12-25', 'AU-NSW', 'Christmas Day'),
    ('2029-12-26', 'AU-NSW', 'Boxing Day'),
    ('2030-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2030-01-28', 'AU-NSW', 'Australia Day'),
    ('2030-04-19', 'AU-NSW', 'Good Friday'),
    ('2030-04-20', 'AU-NSW', 'Easter Saturday'),
    ('2030-04-21', 'AU-NSW', 'Easter Sunday'),
    ('2030-04-22', 'AU-NSW', 'Easter Monday'),
    ('2030-04-25', 'AU-NSW', 'Anzac Day'),
    ('2030-06-10', 'AU-NSW', 'King''s Birthday'),
    ('2030-10-07', 'AU-NSW', 'Labour Day'),
    ('2030-12-25', 'AU-NSW', 'Christmas Day'),
    ('2030-12-26', 'AU-NSW', 'Boxing Day'),
    ('2031-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2031-01-27', 'AU-NSW', 'Australia Day'),
    ('2031-04-11', 'AU-NSW', 'Good Friday'),
    ('2031-04-12', 'AU-NSW', 'Easter Saturday'),
    ('2031-04-13', 'AU-NSW', 'Easter Sunday'),
    ('2031-04-14', 'AU-NSW', 'Easter Monday'),
    ('2031-04-25', 'AU-NSW', 'Anzac Day'),
    ('2031-06-09', 'AU-NSW', 'King''s Birthday'),
    ('2031-10-06', 'AU-NSW', 'Labour Day'),
    ('2031-12-25', 'AU-NSW', 'Christmas Day'),
    ('2031-12-26', 'AU-NSW', 'Boxing Day'),
    ('2032-01-01', 'AU-NSW', 'New Year''s Day'),
    ('2032-01-26', 'AU-NSW', 'Australia Day'),
    ('2032-03-26', 'AU-NSW', 'Good Friday'),
    ('2032-03-27', 'AU-NSW', 'Easter Saturday'),
    ('2032-03-28', 'AU-NSW', 'Easter Sunday'),
    ('2032-03-29', 'AU-NSW', 'Easter Monday'),
    ('2032-04-25', 'AU-NSW', 'Anzac Day'),
    ('2032-04-26', 'AU-NSW', 'Anzac Day (substitute day)'),
    ('2032-06-14', 'AU-NSW', 'King''s Birthday'),
    ('2032-10-04', 'AU-NSW', 'Labour Day'),
    ('2032-12-25', 'AU-NSW', 'Christmas Day'),
    ('2032-12-26', 'AU-NSW', 'Boxing Day'),
    ('2032-12-27', 'AU-NSW', 'Christmas Day (substitute day)'),
    ('2032-12-28', 'AU-NSW', 'Boxing Day (substitute day)')
ON CONFLICT (holiday_date, jurisdiction) DO UPDATE SET name = EXCLUDED.name;

-- Keep the legacy columns coherent rather than leaving them half-populated,
-- then enforce the canonical NOT NULL now that every row has a name.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='public_holidays'
                  AND column_name='holiday_name') THEN
        UPDATE public.public_holidays SET holiday_name = name
         WHERE holiday_name IS DISTINCT FROM name;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='public_holidays'
                  AND column_name='applies_to_state') THEN
        UPDATE public.public_holidays
           SET applies_to_state = split_part(jurisdiction, '-', 2)
         WHERE applies_to_state IS DISTINCT FROM split_part(jurisdiction, '-', 2);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='public_holidays'
                  AND column_name='name' AND is_nullable='YES') THEN
        ALTER TABLE public.public_holidays ALTER COLUMN name SET NOT NULL;
    END IF;
END $$;

-- Coverage guard: fail loudly at apply time if the seed does not extend at
-- least a year past today, rather than silently classifying every future date
-- as a non-holiday (which is exactly how the 2026-only literal failed).
DO $$
DECLARE v_max date;
BEGIN
    SELECT max(holiday_date) INTO v_max
      FROM public.public_holidays WHERE jurisdiction = 'AU-NSW';
    IF v_max IS NULL OR v_max < CURRENT_DATE + INTERVAL '1 year' THEN
        RAISE EXCEPTION
            'public_holidays AU-NSW seed ends at % — extend it past %',
            v_max, (CURRENT_DATE + INTERVAL '1 year')::date;
    END IF;
END $$;
