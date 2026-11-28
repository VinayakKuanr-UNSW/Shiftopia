-- Rate card authoring (docs/architecture/multi-organization.md §11.1 R8/R9).
--
-- Until now a card could only be rolled forward from another card, and only
-- its loadings could be edited. That blocks any organization without a card
-- (BCEC) and any correction short of a whole new period. These RPCs let an
-- Administrator (payroll.manage = zeta at ORG scope, in the card's
-- organization) author a card without hand-written SQL:
--
--   create_rate_card            a blank draft, with its rule set's default loadings
--   update_rate_card_meta       code, name, currency, period, notes, cl 25.3 check
--   upsert_rate_card_rates      add or edit rate lines (one or many)
--   upsert_rate_card_allowances add or edit allowance lines
--   delete_rate_card_items      remove rate and allowance lines
--   update_rate_card_trainee_schedule  the Schedule 5 matrix
--   bulk_adjust_rate_card_rates scale selected classifications' rates
--   copy_rate_card              a new draft from any card the caller manages,
--                               into the same or another organization they manage
--   copy_rate_card_items        selected lines from one card into a draft
--
-- Every write is to a DRAFT (published cards are also locked by trigger,
-- *_rate_card_published_lock) and takes effect on publish_rate_card. Refusals
-- follow the existing RPCs: 42501 one answer for "no such card" and "not
-- yours" (no probing other tenants), 22023 bad input, 55000 published.
--
-- Casual rates (cl 12.5(b)): a casual line's paid rate is ordinary × (1 +
-- the card's casual_loading). Omitted, it is derived; given, it must agree
-- within 2 cents (two roundings: a rolled-forward line scales both rates
-- separately) unless the line is marked is_manual_override.
--
-- New columns: pay_rate_cards.notes / award_floor_checked_at (cl 25.3:
-- rates must stay ≥ 2% above the Award; when someone confirmed it),
-- eba_rate.is_manual_override / notes, eba_allowance.notes, and
-- pay_rate_card_loadings.sws_min_weekly (Schedule 6 §1.4.2, $90), which
-- update_rate_card_loadings now accepts. roll_rate_card_forward carries line
-- notes and override flags.

ALTER TABLE public.pay_rate_cards
    ADD COLUMN IF NOT EXISTS notes text,
    ADD COLUMN IF NOT EXISTS award_floor_checked_at timestamptz;
ALTER TABLE public.eba_rate
    ADD COLUMN IF NOT EXISTS is_manual_override boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.eba_allowance
    ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.pay_rate_card_loadings
    ADD COLUMN IF NOT EXISTS sws_min_weekly numeric NOT NULL DEFAULT 90
        CONSTRAINT pay_rate_card_loadings_sws CHECK (sws_min_weekly >= 0);

COMMENT ON COLUMN public.pay_rate_cards.award_floor_checked_at IS
    'When an Administrator confirmed the card''s rates are at least 2% above the prevailing Award (ICC EA cl 25.3).';
COMMENT ON COLUMN public.eba_rate.is_manual_override IS
    'A casual paid rate deliberately off ordinary × (1 + casual_loading).';
COMMENT ON COLUMN public.pay_rate_card_loadings.sws_min_weekly IS
    'Supported Wage System minimum weekly payment (ICC EA Schedule 6 §1.4.2: $90).';

-- ── Guards ──────────────────────────────────────────────────────────────

-- The draft p_card_id, locked, if the caller manages its organization.
CREATE OR REPLACE FUNCTION internal.draft_rate_card_for_write(p_card_id uuid)
 RETURNS public.pay_rate_cards
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v public.pay_rate_cards;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'card % is published; only a draft can change', v.code USING ERRCODE = '55000';
    END IF;
    RETURN v;
END;
$function$;

-- Any card (draft or published) the caller manages, as a copy source.
CREATE OR REPLACE FUNCTION internal.rate_card_for_copy(p_card_id uuid)
 RETURNS public.pay_rate_cards
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v public.pay_rate_cards;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR SHARE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION internal.draft_rate_card_for_write(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION internal.rate_card_for_copy(uuid) FROM PUBLIC, anon, authenticated;

-- ── create_rate_card ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_rate_card(
    p_org_id uuid, p_code text, p_name text, p_valid_from date,
    p_currency text DEFAULT 'AUD', p_rule_set text DEFAULT 'icc_sydney_ea', p_notes text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_id uuid;
BEGIN
    IF p_org_id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', p_org_id) THEN
        RAISE EXCEPTION 'organization not found, or payroll.manage not held in it' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(p_code), '') IS NULL OR NULLIF(btrim(p_name), '') IS NULL OR p_valid_from IS NULL THEN
        RAISE EXCEPTION 'code, name and start date are required' USING ERRCODE = '22023';
    END IF;
    IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency must be a three-letter ISO code such as AUD, got %', p_currency USING ERRCODE = '22023';
    END IF;
    -- Each rule set brings its own default loadings; only one exists so far.
    IF p_rule_set IS DISTINCT FROM 'icc_sydney_ea' THEN
        RAISE EXCEPTION 'unknown rule set %', p_rule_set USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status, notes)
    VALUES (p_org_id, btrim(p_code), btrim(p_name), p_currency, p_rule_set, p_valid_from, 'draft', NULLIF(btrim(p_notes), ''))
    RETURNING id INTO v_id;

    -- ICC Sydney EA 2025 figures (the seeded ICC cards hold the same).
    INSERT INTO public.pay_rate_card_loadings (
        rate_card_id, casual_loading, saturday_loading, sunday_loading, public_holiday_loading,
        night_loading_mon_thu, night_loading_fri, night_loading_sat_sun, annual_leave_loading,
        overtime_first_hours, overtime_first_multiplier, overtime_after_multiplier, overtime_public_holiday_multiplier,
        ordinary_daily_cap_hours, security_ordinary_cap_hours,
        min_engagement_minutes, min_engagement_sunday_minutes, min_engagement_public_holiday_minutes, min_engagement_training_minutes,
        higher_duties_min_hours, meal_allowance_trigger_hours, sws_min_weekly)
    VALUES (v_id, 0.25, 0.25, 0.5, 1.5, 0.20, 0.25, 0.50, 0.175, 3, 1.5, 2.0, 2.5, 12, 12, 180, 240, 240, 120, 4, 2.0, 90);

    RETURN v_id;
END;
$function$;

-- ── update_rate_card_meta ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_rate_card_meta(p_card_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v      public.pay_rate_cards;
    v_bad  text;
    v_from date;
    v_to   date;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'the change must be a JSON object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_patch) k
     WHERE k NOT IN ('code', 'name', 'currency', 'valid_from', 'valid_to', 'notes', 'award_floor_checked');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'unknown or read-only field(s): %', v_bad USING ERRCODE = '22023';
    END IF;
    IF (p_patch ? 'code' AND NULLIF(btrim(p_patch->>'code'), '') IS NULL)
       OR (p_patch ? 'name' AND NULLIF(btrim(p_patch->>'name'), '') IS NULL) THEN
        RAISE EXCEPTION 'code and name cannot be blank' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'currency' AND coalesce(p_patch->>'currency', '') !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency must be a three-letter ISO code such as AUD' USING ERRCODE = '22023';
    END IF;
    BEGIN
        v_from := CASE WHEN p_patch ? 'valid_from' THEN (p_patch->>'valid_from')::date ELSE v.valid_from END;
        v_to   := CASE WHEN p_patch ? 'valid_to'   THEN (p_patch->>'valid_to')::date   ELSE v.valid_to   END;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'dates must be YYYY-MM-DD' USING ERRCODE = '22023';
    END;
    IF v_from IS NULL OR (v_to IS NOT NULL AND v_to < v_from) THEN
        RAISE EXCEPTION 'the period must start, and end on or after its start' USING ERRCODE = '22023';
    END IF;

    UPDATE public.pay_rate_cards SET
        code       = CASE WHEN p_patch ? 'code' THEN btrim(p_patch->>'code') ELSE code END,
        name       = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE name END,
        currency   = CASE WHEN p_patch ? 'currency' THEN p_patch->>'currency' ELSE currency END,
        valid_from = v_from,
        valid_to   = v_to,
        notes      = CASE WHEN p_patch ? 'notes' THEN NULLIF(btrim(p_patch->>'notes'), '') ELSE notes END,
        award_floor_checked_at = CASE WHEN p_patch ? 'award_floor_checked'
                                      THEN CASE WHEN (p_patch->'award_floor_checked')::boolean THEN now() END
                                      ELSE award_floor_checked_at END
     WHERE id = v.id;
END;
$function$;

-- ── Rate and allowance lines ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_rate_card_rates(p_card_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v          public.pay_rate_cards;
    v_casual   numeric;
    it         jsonb;
    v_class    text;
    v_basis    text;
    v_ord      numeric;
    v_paid     numeric;
    v_override boolean;
    v_formula  numeric;
    n          integer := 0;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'rates must be a non-empty JSON array' USING ERRCODE = '22023';
    END IF;
    SELECT casual_loading INTO v_casual FROM public.pay_rate_card_loadings WHERE rate_card_id = v.id;

    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_class := it->>'classification';
        v_basis := it->>'employment_basis';
        -- Validated as stored: numeric(8,2), cents.
        v_ord   := round((it->'ordinary_hourly_rate')::numeric, 2);
        v_paid  := round((it->'paid_hourly_rate')::numeric, 2);
        IF v_class IS NULL OR v_class !~ '^[A-Z][A-Z0-9_]*$' THEN
            RAISE EXCEPTION 'classification must look like LEVEL_1, got %', v_class USING ERRCODE = '22023';
        END IF;
        IF v_basis IS NULL OR v_basis NOT IN ('permanent', 'casual', 'annualised') THEN
            RAISE EXCEPTION 'employment basis must be permanent, casual or annualised, got %', v_basis USING ERRCODE = '22023';
        END IF;
        IF v_ord IS NULL OR v_ord <= 0 OR v_ord > 999999.99 THEN
            RAISE EXCEPTION '% %: ordinary hourly rate must be greater than 0', v_class, v_basis USING ERRCODE = '22023';
        END IF;
        -- Omitted flag: keep the line's current one.
        v_override := COALESCE((it->'is_manual_override')::boolean,
            (SELECT r.is_manual_override FROM public.eba_rate r
              WHERE r.rate_card_id = v.id AND r.classification = v_class AND r.employment_basis = v_basis),
            false);
        v_formula := NULL;
        IF v_basis = 'casual' THEN
            IF v_casual IS NULL THEN
                RAISE EXCEPTION 'card % has no loadings, so a casual rate cannot be derived', v.code USING ERRCODE = '55000';
            END IF;
            v_formula := round(v_ord * (1 + v_casual), 2);
        END IF;
        IF v_paid IS NULL AND v_override THEN
            -- A manual rate is kept unless a new one is given.
            SELECT r.paid_hourly_rate INTO v_paid FROM public.eba_rate r
             WHERE r.rate_card_id = v.id AND r.classification = v_class AND r.employment_basis = v_basis;
        END IF;
        IF v_paid IS NULL THEN
            v_paid := CASE v_basis WHEN 'permanent' THEN v_ord WHEN 'casual' THEN v_formula END;
            IF v_paid IS NULL THEN
                RAISE EXCEPTION '% annualised: the paid hourly rate is required', v_class USING ERRCODE = '22023';
            END IF;
        END IF;
        IF v_paid <= 0 OR v_paid > 999999.99 THEN
            RAISE EXCEPTION '% %: paid hourly rate must be greater than 0', v_class, v_basis USING ERRCODE = '22023';
        END IF;
        IF v_basis = 'casual' AND NOT v_override AND abs(v_paid - v_formula) > 0.02 THEN
            RAISE EXCEPTION '% casual: paid % is not ordinary × (1 + %) = %; mark it a manual override to keep it',
                v_class, v_paid, v_casual, v_formula USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.eba_rate AS r (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source, notes, is_manual_override)
        VALUES (v.id, v_class, v_basis, v_ord, v_paid, it->>'source', it->>'notes', v_override)
        ON CONFLICT (rate_card_id, classification, employment_basis) DO UPDATE SET
            ordinary_hourly_rate = EXCLUDED.ordinary_hourly_rate,
            paid_hourly_rate     = EXCLUDED.paid_hourly_rate,
            is_manual_override   = EXCLUDED.is_manual_override,
            source = CASE WHEN it ? 'source' THEN EXCLUDED.source ELSE r.source END,
            notes  = CASE WHEN it ? 'notes'  THEN EXCLUDED.notes  ELSE r.notes  END;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_rate_card_allowances(p_card_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v        public.pay_rate_cards;
    it       jsonb;
    v_code   text;
    v_amount numeric;
    v_unit   text;
    n        integer := 0;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'allowances must be a non-empty JSON array' USING ERRCODE = '22023';
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_code   := it->>'code';
        v_amount := round((it->'amount')::numeric, 2);
        v_unit   := it->>'unit';
        IF v_code IS NULL OR v_code !~ '^[a-z][a-z0-9_]*$' THEN
            RAISE EXCEPTION 'allowance code must look like meal or first_aid_per_hour, got %', v_code USING ERRCODE = '22023';
        END IF;
        IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 999999.99 THEN
            RAISE EXCEPTION '%: amount must be greater than 0', v_code USING ERRCODE = '22023';
        END IF;
        IF v_unit IS NULL OR v_unit NOT IN ('per_occasion', 'per_hour', 'per_shift') THEN
            RAISE EXCEPTION '%: unit must be per_occasion, per_hour or per_shift, got %', v_code, v_unit USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.eba_allowance AS a (rate_card_id, code, amount, unit, source, notes)
        VALUES (v.id, v_code, v_amount, v_unit, it->>'source', it->>'notes')
        ON CONFLICT (rate_card_id, code) DO UPDATE SET
            amount = EXCLUDED.amount,
            unit   = EXCLUDED.unit,
            source = CASE WHEN it ? 'source' THEN EXCLUDED.source ELSE a.source END,
            notes  = CASE WHEN it ? 'notes'  THEN EXCLUDED.notes  ELSE a.notes  END;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_rate_card_items(
    p_card_id uuid, p_rates jsonb DEFAULT '[]', p_allowance_codes text[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v  public.pay_rate_cards;
    n  integer;
    m  integer;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF jsonb_typeof(COALESCE(p_rates, '[]')) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'rates must be a JSON array of {classification, employment_basis}' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.eba_rate r
     USING jsonb_to_recordset(COALESCE(p_rates, '[]')) AS k(classification text, employment_basis text)
     WHERE r.rate_card_id = v.id AND r.classification = k.classification AND r.employment_basis = k.employment_basis;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM public.eba_allowance a WHERE a.rate_card_id = v.id AND a.code = ANY (COALESCE(p_allowance_codes, '{}'));
    GET DIAGNOSTICS m = ROW_COUNT;
    RETURN n + m;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_rate_card_trainee_schedule(
    p_card_id uuid, p_matrix jsonb, p_label text DEFAULT NULL, p_source text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v public.pay_rate_cards;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF jsonb_typeof(p_matrix) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'the trainee schedule must be a JSON object' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.eba_trainee_schedule AS t (rate_card_id, matrix, label, source)
    VALUES (v.id, p_matrix, COALESCE(NULLIF(btrim(p_label), ''), v.name), p_source)
    ON CONFLICT (rate_card_id) DO UPDATE SET
        matrix = EXCLUDED.matrix, label = EXCLUDED.label, source = EXCLUDED.source;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_adjust_rate_card_rates(
    p_card_id uuid, p_classifications text[], p_multiplier numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v        public.pay_rate_cards;
    v_casual numeric;
    n        integer;
BEGIN
    v := internal.draft_rate_card_for_write(p_card_id);
    IF p_multiplier IS NULL OR p_multiplier <= 0 OR p_multiplier > 2 THEN
        RAISE EXCEPTION 'multiplier must be greater than 0 and at most 2, got %', p_multiplier USING ERRCODE = '22023';
    END IF;
    SELECT casual_loading INTO v_casual FROM public.pay_rate_card_loadings WHERE rate_card_id = v.id;
    -- NULL classifications: every line. A formula casual line is re-derived
    -- from its new ordinary rate, so it stays exactly on the formula.
    UPDATE public.eba_rate r SET
        ordinary_hourly_rate = round(r.ordinary_hourly_rate * p_multiplier, 2),
        paid_hourly_rate = CASE
            WHEN r.employment_basis = 'casual' AND NOT r.is_manual_override AND v_casual IS NOT NULL
                THEN round(round(r.ordinary_hourly_rate * p_multiplier, 2) * (1 + v_casual), 2)
            ELSE round(r.paid_hourly_rate * p_multiplier, 2) END
     WHERE r.rate_card_id = v.id
       AND (p_classifications IS NULL OR r.classification = ANY (p_classifications));
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$function$;

-- ── Copying ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.copy_rate_card(
    p_source_card_id uuid, p_target_org_id uuid, p_code text, p_name text, p_valid_from date,
    p_options jsonb DEFAULT '{}')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_src   public.pay_rate_cards;
    v_org   uuid;
    v_bad   text;
    v_m     numeric;
    v_id    uuid;
BEGIN
    v_src := internal.rate_card_for_copy(p_source_card_id);
    v_org := COALESCE(p_target_org_id, v_src.organization_id);
    IF NOT public.user_has_action_in_scope('payroll.manage', v_org) THEN
        RAISE EXCEPTION 'organization not found, or payroll.manage not held in it' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(COALESCE(p_options, '{}')) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'options must be a JSON object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(COALESCE(p_options, '{}')) k
     WHERE k NOT IN ('rates', 'allowances', 'trainee', 'multiplier');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'unknown option(s): %', v_bad USING ERRCODE = '22023';
    END IF;
    v_m := COALESCE((p_options->'multiplier')::numeric, 1);
    IF v_m <= 0 OR v_m > 2 THEN
        RAISE EXCEPTION 'multiplier must be greater than 0 and at most 2, got %', v_m USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_code), '') IS NULL OR NULLIF(btrim(p_name), '') IS NULL OR p_valid_from IS NULL THEN
        RAISE EXCEPTION 'code, name and start date are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status, derivation, notes)
    VALUES (v_org, btrim(p_code), btrim(p_name), v_src.currency, v_src.rule_set, p_valid_from, 'draft',
            format('%s × %s', v_src.code, v_m), v_src.notes)
    RETURNING id INTO v_id;

    IF COALESCE((p_options->'rates')::boolean, true) THEN
        INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source, notes, is_manual_override)
        SELECT v_id, r.classification, r.employment_basis, round(r.ordinary_hourly_rate * v_m, 2),
               round(r.paid_hourly_rate * v_m, 2), r.source, r.notes, r.is_manual_override
          FROM public.eba_rate r WHERE r.rate_card_id = v_src.id;
    END IF;
    IF COALESCE((p_options->'allowances')::boolean, true) THEN
        INSERT INTO public.eba_allowance (rate_card_id, code, amount, unit, source, notes)
        SELECT v_id, a.code, round(a.amount * v_m, 2), a.unit, a.source, a.notes
          FROM public.eba_allowance a WHERE a.rate_card_id = v_src.id;
    END IF;
    IF COALESCE((p_options->'trainee')::boolean, true) THEN
        INSERT INTO public.eba_trainee_schedule (rate_card_id, matrix, label, source)
        SELECT v_id, internal.scale_money(t.matrix, v_m), btrim(p_name), t.source
          FROM public.eba_trainee_schedule t WHERE t.rate_card_id = v_src.id;
    END IF;
    -- Loadings are required to publish, so they are always copied (unscaled:
    -- fractions, hours and minutes).
    INSERT INTO public.pay_rate_card_loadings
    SELECT (jsonb_populate_record(NULL::public.pay_rate_card_loadings,
              to_jsonb(l) || jsonb_build_object('rate_card_id', v_id, 'created_at', now(), 'updated_at', now()))).*
      FROM public.pay_rate_card_loadings l WHERE l.rate_card_id = v_src.id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.copy_rate_card_items(
    p_target_card_id uuid, p_source_card_id uuid, p_classifications text[], p_allowance_codes text[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v     public.pay_rate_cards;
    v_src public.pay_rate_cards;
    n     integer;
    m     integer;
BEGIN
    -- Both cards in id order first: copy(A <- B) racing copy(B <- A) would
    -- otherwise each hold one card and wait for the other.
    PERFORM 1 FROM public.pay_rate_cards WHERE id IN (p_target_card_id, p_source_card_id) ORDER BY id FOR UPDATE;
    v := internal.draft_rate_card_for_write(p_target_card_id);
    v_src := internal.rate_card_for_copy(p_source_card_id);
    IF COALESCE(cardinality(p_classifications), 0) + COALESCE(cardinality(p_allowance_codes), 0) = 0 THEN
        RAISE EXCEPTION 'name the classifications or allowances to copy' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.eba_rate AS r (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source, notes, is_manual_override)
    SELECT v.id, s.classification, s.employment_basis, s.ordinary_hourly_rate, s.paid_hourly_rate, s.source, s.notes, s.is_manual_override
      FROM public.eba_rate s
     WHERE s.rate_card_id = v_src.id AND s.classification = ANY (COALESCE(p_classifications, '{}'))
    ON CONFLICT (rate_card_id, classification, employment_basis) DO UPDATE SET
        ordinary_hourly_rate = EXCLUDED.ordinary_hourly_rate, paid_hourly_rate = EXCLUDED.paid_hourly_rate,
        source = EXCLUDED.source, notes = EXCLUDED.notes, is_manual_override = EXCLUDED.is_manual_override;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO public.eba_allowance AS a (rate_card_id, code, amount, unit, source, notes)
    SELECT v.id, s.code, s.amount, s.unit, s.source, s.notes
      FROM public.eba_allowance s
     WHERE s.rate_card_id = v_src.id AND s.code = ANY (COALESCE(p_allowance_codes, '{}'))
    ON CONFLICT (rate_card_id, code) DO UPDATE SET
        amount = EXCLUDED.amount, unit = EXCLUDED.unit, source = EXCLUDED.source, notes = EXCLUDED.notes;
    GET DIAGNOSTICS m = ROW_COUNT;
    RETURN n + m;
END;
$function$;

-- ── Existing RPCs: carry the new columns ────────────────────────────────

CREATE OR REPLACE FUNCTION public.roll_rate_card_forward(p_source_card_id uuid, p_code text, p_name text, p_valid_from date, p_multiplier numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_src public.pay_rate_cards;
    v_id  uuid;
BEGIN
    SELECT * INTO v_src FROM public.pay_rate_cards WHERE id = p_source_card_id;
    -- One answer for "no such card" and "not yours": no probing other tenants.
    IF v_src.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v_src.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF p_multiplier IS NULL OR p_multiplier <= 0 OR p_multiplier > 2 THEN
        RAISE EXCEPTION 'multiplier must be greater than 0 and at most 2, got %', p_multiplier USING ERRCODE = '22023';
    END IF;
    IF p_valid_from IS NULL OR p_valid_from <= v_src.valid_from THEN
        RAISE EXCEPTION 'the new card must start after its source (%)', v_src.valid_from USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(p_code), '') IS NULL OR NULLIF(btrim(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'code and name are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status, derivation)
    VALUES (v_src.organization_id, btrim(p_code), btrim(p_name), v_src.currency, v_src.rule_set, p_valid_from, 'draft',
            format('%s × %s', v_src.code, p_multiplier))
    RETURNING id INTO v_id;

    INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source, notes, is_manual_override)
    SELECT v_id, r.classification, r.employment_basis,
           round(r.ordinary_hourly_rate * p_multiplier, 2), round(r.paid_hourly_rate * p_multiplier, 2), r.source,
           r.notes, r.is_manual_override
      FROM public.eba_rate r WHERE r.rate_card_id = v_src.id;
    INSERT INTO public.eba_allowance (rate_card_id, code, amount, unit, source, notes)
    SELECT v_id, a.code, round(a.amount * p_multiplier, 2), a.unit, a.source, a.notes
      FROM public.eba_allowance a WHERE a.rate_card_id = v_src.id;
    INSERT INTO public.eba_trainee_schedule (rate_card_id, matrix, label, source)
    SELECT v_id, internal.scale_money(t.matrix, p_multiplier), btrim(p_name), t.source
      FROM public.eba_trainee_schedule t WHERE t.rate_card_id = v_src.id;
    -- Loadings are fractions, hours and minutes: copied unchanged (the
    -- multiplier scales money, not percentages).
    INSERT INTO public.pay_rate_card_loadings
    SELECT (jsonb_populate_record(NULL::public.pay_rate_card_loadings,
              to_jsonb(l) || jsonb_build_object('rate_card_id', v_id, 'created_at', now(), 'updated_at', now()))).*
      FROM public.pay_rate_card_loadings l WHERE l.rate_card_id = v_src.id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_rate_card_loadings(p_card_id uuid, p_loadings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v       public.pay_rate_cards;
    l       public.pay_rate_card_loadings;
    v_bad   text;
BEGIN
    SELECT * INTO v FROM public.pay_rate_cards WHERE id = p_card_id FOR UPDATE;
    IF v.id IS NULL OR NOT public.user_has_action_in_scope('payroll.manage', v.organization_id) THEN
        RAISE EXCEPTION 'rate card not found, or payroll.manage not held in its organization' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'draft' THEN
        RAISE EXCEPTION 'card % is published; only a draft''s loadings can change', v.code USING ERRCODE = '55000';
    END IF;
    IF jsonb_typeof(p_loadings) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'loadings must be a JSON object' USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad
      FROM jsonb_object_keys(p_loadings) k
     WHERE k IN ('rate_card_id', 'created_at', 'updated_at')
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                        WHERE a.attrelid = 'public.pay_rate_card_loadings'::regclass
                          AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'unknown or read-only loading(s): %', v_bad USING ERRCODE = '22023';
    END IF;

    SELECT * INTO l FROM public.pay_rate_card_loadings WHERE rate_card_id = v.id FOR UPDATE;
    IF l.rate_card_id IS NULL THEN
        RAISE EXCEPTION 'card % has no loadings', v.code USING ERRCODE = '55000';
    END IF;
    l := jsonb_populate_record(l, p_loadings);

    UPDATE public.pay_rate_card_loadings SET
        casual_loading                        = l.casual_loading,
        saturday_loading                      = l.saturday_loading,
        sunday_loading                        = l.sunday_loading,
        public_holiday_loading                = l.public_holiday_loading,
        night_loading_mon_thu                 = l.night_loading_mon_thu,
        night_loading_fri                     = l.night_loading_fri,
        night_loading_sat_sun                 = l.night_loading_sat_sun,
        annual_leave_loading                  = l.annual_leave_loading,
        overtime_first_hours                  = l.overtime_first_hours,
        overtime_first_multiplier             = l.overtime_first_multiplier,
        overtime_after_multiplier             = l.overtime_after_multiplier,
        overtime_public_holiday_multiplier    = l.overtime_public_holiday_multiplier,
        ordinary_daily_cap_hours              = l.ordinary_daily_cap_hours,
        security_ordinary_cap_hours           = l.security_ordinary_cap_hours,
        min_engagement_minutes                = l.min_engagement_minutes,
        min_engagement_sunday_minutes         = l.min_engagement_sunday_minutes,
        min_engagement_public_holiday_minutes = l.min_engagement_public_holiday_minutes,
        min_engagement_training_minutes       = l.min_engagement_training_minutes,
        higher_duties_min_hours               = l.higher_duties_min_hours,
        meal_allowance_trigger_hours          = l.meal_allowance_trigger_hours,
        sws_min_weekly                        = l.sws_min_weekly
     WHERE rate_card_id = v.id;
END;
$function$;

-- ── Privileges: authenticated callers only; the functions gate themselves ──

REVOKE ALL ON FUNCTION public.create_rate_card(uuid, text, text, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_rate_card_meta(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_rate_card_rates(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_rate_card_allowances(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_rate_card_items(uuid, jsonb, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_rate_card_trainee_schedule(uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_adjust_rate_card_rates(uuid, text[], numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_rate_card(uuid, uuid, text, text, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.copy_rate_card_items(uuid, uuid, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_rate_card(uuid, text, text, date, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_rate_card_meta(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_rate_card_rates(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_rate_card_allowances(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_rate_card_items(uuid, jsonb, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_rate_card_trainee_schedule(uuid, jsonb, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_adjust_rate_card_rates(uuid, text[], numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.copy_rate_card(uuid, uuid, text, text, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.copy_rate_card_items(uuid, uuid, text[], text[]) TO authenticated, service_role;
