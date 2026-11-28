-- Public holidays: checked against the government's published lists, with no
-- manual confirm step (docs/architecture/multi-organization.md §11.1 R11, §13).
--
-- Why: public_holidays is generated from rules (`date-holidays` + the Ekka rule,
-- §3/§5). A state can proclaim, move, or drop a holiday and the rules do not
-- know. Pay is computed when read, so a corrected row reprices every affected
-- shift immediately; what was missing was automated reconciliation against the
-- official government lists.
--
-- What changes:
--   1. public_holidays: NOT NULL created_at, updated_at + trigger, plus
--      source ('rule' | 'gazetted') and gazetted_at with a consistency CHECK.
--   2. public_holiday_checks: latest check summary per (jurisdiction, year)
--      with bounds and count-identity CHECK constraints and audit timestamps.
--   3. public_holiday_discrepancies: current findings per (jurisdiction, date,
--      kind) — official_only (inserted), table_only (kept for human review,
--      never deleted silently), name_differs (informational) — preserving
--      first_seen_at across runs and refreshing last_seen_at.
--   4. reconcile_public_holidays(payload): service_role-only, guarded by a
--      transactional advisory lock (pg_try_advisory_xact_lock) for single-
--      execution cron safety. Marks official matches gazetted, inserts missing
--      official dates as gazetted, demotes unconfirmed table_only dates back to
--      'rule' without deleting them, and notifies active Administrators (zeta)
--      of every active organization whose jurisdiction lineage includes newly
--      seen official_only / table_only discrepancies. Re-running the same
--      payload is a no-op and sends no duplicate notifications.
--
-- Runner: .github/workflows/public-holidays-check.yml fetches the official
-- lists (scripts/holidays/official-holidays.mjs) and invokes this function
-- monthly.

-- ── 1. Provenance & OLTP audit fields on public_holidays ─────────────────────
UPDATE public.public_holidays SET created_at = now() WHERE created_at IS NULL;

ALTER TABLE public.public_holidays
    ALTER COLUMN created_at SET NOT NULL,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rule',
    ADD COLUMN IF NOT EXISTS gazetted_at timestamptz;

ALTER TABLE public.public_holidays DROP CONSTRAINT IF EXISTS public_holidays_source_check;
ALTER TABLE public.public_holidays ADD CONSTRAINT public_holidays_source_check
    CHECK (source IN ('rule', 'gazetted') AND (source = 'gazetted') = (gazetted_at IS NOT NULL));

DROP TRIGGER IF EXISTS update_public_holidays_updated_at ON public.public_holidays;
CREATE TRIGGER update_public_holidays_updated_at
    BEFORE UPDATE ON public.public_holidays
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.public_holidays.source IS
    'rule = generated from holiday rules; gazetted = confirmed on the government''s published list for its year (reconcile_public_holidays).';

-- ── 2. Check summaries & discrepancy log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_holiday_checks (
    jurisdiction   text        NOT NULL REFERENCES public.jurisdictions (code) ON DELETE RESTRICT,
    year           integer     NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    source_url     text        NOT NULL CHECK (length(btrim(source_url)) > 0),
    checked_at     timestamptz NOT NULL DEFAULT now(),
    official_count integer     NOT NULL,
    matched        integer     NOT NULL,
    official_only  integer     NOT NULL,
    table_only     integer     NOT NULL,
    name_differs   integer     NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (jurisdiction, year),
    CONSTRAINT public_holiday_checks_counts_valid CHECK (
        official_count >= 0 AND matched >= 0 AND official_only >= 0
        AND table_only >= 0 AND name_differs >= 0
        AND matched + official_only = official_count)
);
COMMENT ON TABLE public.public_holiday_checks IS
    'Latest automated comparison of one jurisdiction-year against its official government holiday list.';

DROP TRIGGER IF EXISTS update_public_holiday_checks_updated_at ON public.public_holiday_checks;
CREATE TRIGGER update_public_holiday_checks_updated_at
    BEFORE UPDATE ON public.public_holiday_checks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.public_holiday_discrepancies (
    jurisdiction  text        NOT NULL REFERENCES public.jurisdictions (code) ON DELETE RESTRICT,
    holiday_date  date        NOT NULL,
    kind          text        NOT NULL CHECK (kind IN ('official_only', 'table_only', 'name_differs')),
    official_name text,
    table_name    text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (jurisdiction, holiday_date, kind),
    CONSTRAINT public_holiday_discrepancies_names_by_kind CHECK (
        (kind = 'official_only' AND official_name IS NOT NULL AND table_name IS NULL)
        OR (kind = 'table_only' AND official_name IS NULL AND table_name IS NOT NULL)
        OR (kind = 'name_differs' AND official_name IS NOT NULL AND table_name IS NOT NULL
            AND official_name IS DISTINCT FROM table_name))
);
COMMENT ON TABLE public.public_holiday_discrepancies IS
    'Open discrepancies from the latest official public holiday reconciliation run (first_seen_at preserved across runs).';

-- Universal calendar metadata like public_holidays itself: signed-in users
-- read; only the service role (via reconcile_public_holidays) writes.
ALTER TABLE public.public_holiday_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holiday_discrepancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_holiday_checks_select ON public.public_holiday_checks;
CREATE POLICY public_holiday_checks_select ON public.public_holiday_checks
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS public_holiday_discrepancies_select ON public.public_holiday_discrepancies;
CREATE POLICY public_holiday_discrepancies_select ON public.public_holiday_discrepancies
    FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.public_holiday_checks, public.public_holiday_discrepancies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_holiday_checks, public.public_holiday_discrepancies TO authenticated;
GRANT ALL ON public.public_holiday_checks, public.public_holiday_discrepancies TO service_role;

-- ── 3. Reconciliation RPC (service_role only) ────────────────────────────────
-- Payload: {"jurisdictions": [{"jurisdiction": "AU-NSW", "year": 2026,
--   "source_url": "https://…", "holidays": [{"date": "2026-01-01", "name": "…"}]}]}
-- Each entry holds one jurisdiction's OWN whole-day public holidays for one
-- year as published by the government. Returns a JSON summary.
CREATE OR REPLACE FUNCTION public.reconcile_public_holidays(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    -- One instant for the whole run: "first seen in this run" = first_seen_at = v_now.
    v_now        timestamptz := clock_timestamp();
    v_entry      jsonb;
    v_code       text;
    v_year       int;
    v_first_year int;
    v_last_year  int;
    v_counts     record;
    v_checked    int := 0;
    v_skipped    jsonb := '[]';
    v_totals     jsonb := jsonb_build_object('matched', 0, 'official_only', 0, 'table_only', 0, 'name_differs', 0);
    v_notified   int := 0;
    r            record;
BEGIN
    -- Single-execution guard for scheduled / overlapping runs (AGENTS.md §6).
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('reconcile_public_holidays')) THEN
        RETURN jsonb_build_object('skipped_locked', true);
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload -> 'jurisdictions') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'payload needs a "jurisdictions" array' USING ERRCODE = '22023';
    END IF;

    IF to_regclass('pg_temp.official') IS NULL THEN
        CREATE TEMP TABLE official (holiday_date date PRIMARY KEY, name text NOT NULL) ON COMMIT DROP;
    END IF;
    IF to_regclass('pg_temp.found') IS NULL THEN
        CREATE TEMP TABLE found (holiday_date date, kind text, official_name text, table_name text) ON COMMIT DROP;
    END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_payload -> 'jurisdictions') LOOP
        v_code := v_entry ->> 'jurisdiction';
        v_year := (v_entry ->> 'year')::int;
        IF NOT EXISTS (SELECT 1 FROM public.jurisdictions WHERE code = v_code) THEN
            RAISE EXCEPTION 'unknown jurisdiction %', v_code USING ERRCODE = '22023';
        END IF;
        IF v_year IS NULL OR v_year < 2000 OR v_year > 2100
           OR coalesce(btrim(v_entry ->> 'source_url'), '') = ''
           OR jsonb_typeof(v_entry -> 'holidays') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'entry for % needs year, source_url and a holidays array', v_code USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_entry -> 'holidays') h
                    WHERE extract(year FROM (h ->> 'date')::date) IS DISTINCT FROM v_year
                       OR coalesce(btrim(h ->> 'name'), '') = '') THEN
            RAISE EXCEPTION 'entry % %: every holiday needs a name and a date in that year', v_code, v_year
                USING ERRCODE = '22023';
        END IF;

        -- Only years this jurisdiction already covers are reconciled; others are skipped.
        SELECT min(extract(year FROM holiday_date))::int, max(extract(year FROM holiday_date))::int
          INTO v_first_year, v_last_year
          FROM public.public_holidays
         WHERE jurisdiction = v_code;
        IF v_first_year IS NULL OR v_year < v_first_year OR v_year > v_last_year THEN
            v_skipped := v_skipped || to_jsonb(v_code || ' ' || v_year);
            CONTINUE;
        END IF;

        TRUNCATE pg_temp.official, pg_temp.found;
        INSERT INTO pg_temp.official
        SELECT DISTINCT ON ((h ->> 'date')::date) (h ->> 'date')::date, btrim(h ->> 'name')
          FROM jsonb_array_elements(v_entry -> 'holidays') h
         ORDER BY (h ->> 'date')::date, btrim(h ->> 'name');

        -- Diff before modifying public_holidays.
        INSERT INTO pg_temp.found
        SELECT coalesce(o.holiday_date, ph.holiday_date),
               CASE WHEN ph.holiday_date IS NULL THEN 'official_only'
                    WHEN o.holiday_date IS NULL THEN 'table_only'
                    ELSE 'name_differs' END,
               o.name, ph.name
          FROM pg_temp.official o
          FULL JOIN (SELECT * FROM public.public_holidays
                      WHERE jurisdiction = v_code AND extract(year FROM holiday_date) = v_year) ph
            ON ph.holiday_date = o.holiday_date
         WHERE o.holiday_date IS NULL OR ph.holiday_date IS NULL OR o.name IS DISTINCT FROM ph.name;

        -- Official dates are authoritative: insert missing ones as gazetted ...
        INSERT INTO public.public_holidays (holiday_date, jurisdiction, name, source, gazetted_at)
        SELECT holiday_date, v_code, official_name, 'gazetted', v_now
          FROM pg_temp.found WHERE kind = 'official_only'
        ON CONFLICT (holiday_date, jurisdiction) DO NOTHING;

        -- ... confirm existing matches as gazetted ...
        UPDATE public.public_holidays ph
           SET source = 'gazetted', gazetted_at = v_now
          FROM pg_temp.official o
         WHERE ph.jurisdiction = v_code AND ph.holiday_date = o.holiday_date AND ph.source <> 'gazetted';

        -- ... and keep unconfirmed table_only rows for human review, demoted to rule.
        UPDATE public.public_holidays ph
           SET source = 'rule', gazetted_at = NULL
          FROM pg_temp.found f
         WHERE ph.jurisdiction = v_code AND ph.holiday_date = f.holiday_date
           AND f.kind = 'table_only' AND ph.source <> 'rule';

        -- Replace resolved findings for this jurisdiction-year; keep first_seen_at on persistent ones.
        DELETE FROM public.public_holiday_discrepancies d
         WHERE d.jurisdiction = v_code AND extract(year FROM d.holiday_date) = v_year
           AND NOT EXISTS (SELECT 1 FROM pg_temp.found f
                            WHERE f.holiday_date = d.holiday_date AND f.kind = d.kind);

        INSERT INTO public.public_holiday_discrepancies
               (jurisdiction, holiday_date, kind, official_name, table_name, first_seen_at, last_seen_at)
        SELECT v_code, holiday_date, kind, official_name, table_name, v_now, v_now
          FROM pg_temp.found
        ON CONFLICT (jurisdiction, holiday_date, kind) DO UPDATE
           SET official_name = EXCLUDED.official_name,
               table_name    = EXCLUDED.table_name,
               last_seen_at  = EXCLUDED.last_seen_at;

        SELECT (SELECT count(*) FROM pg_temp.official)                                                   AS official_count,
               (SELECT count(*) FROM pg_temp.official) - count(*) FILTER (WHERE kind = 'official_only')  AS matched,
               count(*) FILTER (WHERE kind = 'official_only')                                            AS official_only,
               count(*) FILTER (WHERE kind = 'table_only')                                               AS table_only,
               count(*) FILTER (WHERE kind = 'name_differs')                                             AS name_differs
          INTO v_counts
          FROM pg_temp.found;

        INSERT INTO public.public_holiday_checks
               (jurisdiction, year, source_url, checked_at, official_count, matched, official_only, table_only, name_differs)
        VALUES (v_code, v_year, btrim(v_entry ->> 'source_url'), v_now, v_counts.official_count, v_counts.matched,
                v_counts.official_only, v_counts.table_only, v_counts.name_differs)
        ON CONFLICT (jurisdiction, year) DO UPDATE
           SET source_url     = EXCLUDED.source_url,
               checked_at     = EXCLUDED.checked_at,
               official_count = EXCLUDED.official_count,
               matched        = EXCLUDED.matched,
               official_only  = EXCLUDED.official_only,
               table_only     = EXCLUDED.table_only,
               name_differs   = EXCLUDED.name_differs;

        v_checked := v_checked + 1;
        v_totals := jsonb_build_object(
            'matched',       (v_totals ->> 'matched')::int       + v_counts.matched,
            'official_only', (v_totals ->> 'official_only')::int + v_counts.official_only,
            'table_only',    (v_totals ->> 'table_only')::int    + v_counts.table_only,
            'name_differs',  (v_totals ->> 'name_differs')::int  + v_counts.name_differs);
    END LOOP;

    -- Notify active Administrators (zeta) of each active organization affected
    -- by findings first seen in this run. Re-running sends nothing; name_differs
    -- is informational only.
    FOR r IN
        WITH fresh AS (
            SELECT d.*, j.name AS jurisdiction_name
              FROM public.public_holiday_discrepancies d
              JOIN public.jurisdictions j ON j.code = d.jurisdiction
             WHERE d.first_seen_at = v_now AND d.kind IN ('official_only', 'table_only')
        ), per_org AS (
            SELECT o.id AS organization_id,
                   count(*) AS n,
                   bool_or(f.kind = 'official_only') AS has_added,
                   bool_or(f.kind = 'table_only') AS has_table_only,
                   string_agg(
                       to_char(f.holiday_date, 'Dy DD Mon YYYY') || ', ' || coalesce(f.official_name, f.table_name)
                       || ' (' || f.jurisdiction_name || ')'
                       || CASE f.kind WHEN 'official_only' THEN ': added from the official list'
                                      ELSE ': not on the official list, kept for review' END,
                       '; ' ORDER BY f.holiday_date, f.jurisdiction) AS findings
              FROM public.organizations o
              JOIN fresh f ON f.jurisdiction = ANY (public.jurisdiction_lineage(o.jurisdiction))
             WHERE o.is_active
             GROUP BY o.id
        )
        SELECT DISTINCT p.organization_id, p.n, p.has_added, p.has_table_only, p.findings, c.user_id
          FROM per_org p
          JOIN public.app_access_certificates c
            ON c.organization_id = p.organization_id AND c.access_level = 'zeta' AND c.is_active
    LOOP
        PERFORM public.notify_user(
            r.user_id,
            'general',
            CASE WHEN r.n = 1 THEN 'A public holiday differs from the official list'
                 ELSE r.n || ' public holidays differ from the official list' END,
            r.findings || CASE
                WHEN r.has_added AND r.has_table_only THEN '. Added days already apply to pay; unconfirmed days stay on the calendar until reviewed.'
                WHEN r.has_added THEN '. Pay already follows the updated calendar.'
                ELSE '. Kept on the calendar until reviewed.'
            END,
            NULL,
            'public_holidays',
            '/my-notifications',
            'public_holiday_check:' || r.user_id || ':' || md5(r.organization_id::text || r.findings));
        v_notified := v_notified + 1;
    END LOOP;

    RETURN v_totals || jsonb_build_object('checked', v_checked, 'skipped', v_skipped, 'notified', v_notified);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_public_holidays(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_public_holidays(jsonb) TO service_role;
