-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Rate card loadings (migration *_rate_card_loadings; multi-organization.md §12):
-- loadings live on pay_rate_card_loadings, roll forward unchanged, are editable
-- on drafts only by payroll.manage in the card's organization, are required to
-- publish, are removed on discard, and drive both standard and annualised
-- security shift pricing. One line per case.
\set QUIET on
BEGIN;

DO $t$
DECLARE
    z  constant uuid := 'a0000000-0000-4000-8000-000000000005';  -- zeta, organization O
    e  constant uuid := 'a0000000-0000-4000-8000-000000000004';  -- epsilon, organization O
    f  constant uuid := 'a0000000-0000-4000-8000-000000000008';  -- epsilon, other organization
    x  constant uuid := 'a0000000-0000-4000-8000-000000000006';  -- employee, organization O
    src       uuid;
    draft     uuid;
    bare      uuid;
    n         int;
    sat_before numeric;
    sat_after  numeric;
    nig_before numeric;
    nig_after  numeric;
    min_before numeric;
    min_after  numeric;
    hd_before  numeric;
    hd_after   numeric;
    ot_before  numeric;
    ot_after   numeric;
    ph_before  numeric;
    ph_after   numeric;
    sec_before numeric;
    sec_after  numeric;
    sec_shift  public.shifts;
BEGIN
    SELECT id INTO src FROM public.pay_rate_cards WHERE code = 'ICC-EA-2026-27';

    -- 1. Seeded ICC cards carry loadings.
    RAISE NOTICE 'both ICC cards carry loadings: %', (
        SELECT count(*) = 2
          FROM public.pay_rate_card_loadings l
          JOIN public.pay_rate_cards c ON c.id = l.rate_card_id
         WHERE c.code IN ('ICC-EA-2025', 'ICC-EA-2026-27')
           AND l.casual_loading = 0.25 AND l.saturday_loading = 0.25
           AND l.sunday_loading = 0.5 AND l.public_holiday_loading = 1.5
           AND l.annual_leave_loading = 0.175);

    -- 2. Roll-forward copies loadings UNCHANGED (multiplier scales money, not percentages).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    draft := public.roll_rate_card_forward(src, 'ICC-EA-2027-28', 'ICC Sydney EA 2027–28', '2027-07-05', 1.042);
    RESET ROLE;

    RAISE NOTICE 'roll-forward copies loadings unchanged: %', (
        SELECT (to_jsonb(d) - ARRAY['rate_card_id', 'created_at', 'updated_at'])
             = (to_jsonb(s) - ARRAY['rate_card_id', 'created_at', 'updated_at'])
          FROM public.pay_rate_card_loadings d, public.pay_rate_card_loadings s
         WHERE d.rate_card_id = draft AND s.rate_card_id = src);

    -- 3. Draft loadings visibility: Administrator sees them, employee does not.
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN x ELSE z END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        RAISE NOTICE '% sees draft loadings: %',
            CASE n WHEN 1 THEN 'employee' ELSE 'Administrator' END,
            (SELECT count(*) FROM public.pay_rate_card_loadings WHERE rate_card_id = draft);
        RESET ROLE;
    END LOOP;

    -- 4. update_rate_card_loadings access control & validation.
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN e ELSE f END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
            PERFORM public.update_rate_card_loadings(draft, '{"saturday_loading": 0.40}'::jsonb);
            RAISE NOTICE '% edits draft loadings: allowed', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '% edits draft loadings: refused (%)', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END, SQLSTATE;
        END;
        RESET ROLE;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.update_rate_card_loadings(src, '{"saturday_loading": 0.40}'::jsonb);
        RAISE NOTICE 'edit published loadings: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'edit published loadings: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_loadings(draft, '{"bogus_key": 1}'::jsonb);
        RAISE NOTICE 'unknown loading key: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unknown loading key: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_loadings(draft, '{"rate_card_id": "00000000-0000-0000-0000-000000000000"}'::jsonb);
        RAISE NOTICE 'read-only key: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'read-only key: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_loadings(draft, '[1, 2]'::jsonb);
        RAISE NOTICE 'non-object payload: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'non-object payload: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_loadings(draft, '{"saturday_loading": 5}'::jsonb);
        RAISE NOTICE 'out-of-range loading: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'out-of-range loading: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_loadings(draft, '{"overtime_first_multiplier": 2.0, "overtime_after_multiplier": 1.5}'::jsonb);
        RAISE NOTICE 'inverted OT tiers: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'inverted OT tiers: refused (%)', SQLSTATE;
    END;

    -- 5. Edit draft loadings to distinct non-ICC figures, leaving rates at 1.0x
    -- on a fresh draft so every cost delta proves the loading — not base rate — drove it.
    PERFORM public.discard_rate_card(draft);
    RAISE NOTICE 'discard removes loadings too: %', NOT EXISTS (SELECT 1 FROM public.pay_rate_card_loadings WHERE rate_card_id = draft);

    draft := public.roll_rate_card_forward(src, 'ICC-EA-2027-CUSTOM', 'Custom loadings test', '2027-07-05', 1.0);
    PERFORM public.update_rate_card_loadings(draft, jsonb_build_object(
        'saturday_loading', 0.40,
        'night_loading_mon_thu', 0.30,
        'min_engagement_minutes', 240,
        'higher_duties_min_hours', 5,
        'overtime_first_hours', 2,
        'overtime_first_multiplier', 1.75,
        'overtime_after_multiplier', 2.25,
        'overtime_public_holiday_multiplier', 3.0,
        'security_ordinary_cap_hours', 10,
        'meal_allowance_trigger_hours', 1.5
    ));
    RAISE NOTICE 'partial update keeps untouched fields: %', (
        SELECT saturday_loading = 0.40 AND sunday_loading = 0.5 AND casual_loading = 0.25
          FROM public.pay_rate_card_loadings WHERE rate_card_id = draft);

    PERFORM public.publish_rate_card(draft);
    RESET ROLE;

    -- 6. Pricing reads the published card's loadings across EVERY branch.
    -- Same rates (1.0x), same shift shapes, comparing src (ICC) vs draft (custom):
    --   a) Casual Saturday 7h at $34.64/h (ord $27.712): +25% vs +40%
    sat_before := public.fn_eba_estimate_shift_cost('2027-07-10', '07:00', 420, 420, 34.64, 'Casual', false, false, false, false, NULL, 0, src, 'AU-NSW');
    sat_after  := public.fn_eba_estimate_shift_cost('2027-07-10', '07:00', 420, 420, 34.64, 'Casual', false, false, false, false, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'Saturday casual 7h: ICC=% custom=%', sat_before, sat_after;

    --   b) FT Mon-Thu night 22:00-05:30 (7.5h) at $32.39/h: +20% vs +30%
    nig_before := public.fn_eba_estimate_shift_cost('2027-07-06', '22:00', 450, 450, 32.39, 'FT', false, false, false, false, NULL, 0, src, 'AU-NSW');
    nig_after  := public.fn_eba_estimate_shift_cost('2027-07-06', '22:00', 450, 450, 32.39, 'FT', false, false, false, false, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'Night FT 7.5h: ICC=% custom=%', nig_before, nig_after;

    --   c) Short Casual weekday 1h at $34.64/h: 3h floor vs 4h floor
    min_before := public.fn_eba_estimate_shift_cost('2027-07-06', '09:00', 60, 60, 34.64, 'Casual', false, false, false, false, NULL, 0, src, 'AU-NSW');
    min_after  := public.fn_eba_estimate_shift_cost('2027-07-06', '09:00', 60, 60, 34.64, 'Casual', false, false, false, false, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'Min engagement 1h casual: ICC=% custom=%', min_before, min_after;

    --   d) Higher duties 3h weekday at $43.12/h: 4h floor vs 5h floor
    hd_before := public.fn_eba_estimate_shift_cost('2027-07-06', '09:00', 180, 180, 43.12, 'Casual', false, false, false, true, NULL, 0, src, 'AU-NSW');
    hd_after  := public.fn_eba_estimate_shift_cost('2027-07-06', '09:00', 180, 180, 43.12, 'Casual', false, false, false, true, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'Higher duties 3h casual: ICC=% custom=%', hd_before, hd_after;

    --   e) FT weekday 11h worked vs 8h scheduled (3h OT) at $32.39/h:
    --      ICC = 8h ord + 3h*1.5 + meal; custom = 8h ord + 2h*1.75 + 1h*2.25 + meal
    ot_before := public.fn_eba_estimate_shift_cost('2027-07-06', '08:00', 660, 480, 32.39, 'FT', false, false, false, false, NULL, 0, src, 'AU-NSW');
    ot_after  := public.fn_eba_estimate_shift_cost('2027-07-06', '08:00', 660, 480, 32.39, 'FT', false, false, false, false, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'OT FT 8h+3h (1.5x/2x vs 1.75x/2.25x): ICC=% custom=%', ot_before, ot_after;

    --   f) FT Public Holiday (2027-10-04 NSW Labour Day) 9.5h worked vs 8h scheduled (1.5h OT):
    --      ICC: PH OT 2.5x, no meal (<2h); custom: PH OT 3.0x + meal (>=1.5h)
    ph_before := public.fn_eba_estimate_shift_cost('2027-10-04', '08:00', 570, 480, 32.39, 'FT', false, false, false, false, NULL, 0, src, 'AU-NSW');
    ph_after  := public.fn_eba_estimate_shift_cost('2027-10-04', '08:00', 570, 480, 32.39, 'FT', false, false, false, false, NULL, 0, draft, 'AU-NSW');
    RAISE NOTICE 'PH OT FT 8h+1.5h + meal trigger: ICC=% custom=%', ph_before, ph_after;

    --   g) Annualised Security 12h shift (internal.shift_cost):
    --      ICC cap 12h (0 OT) on 2027-07-04 vs custom cap 10h (2h OT at 1.75x) on 2027-07-06
    SET LOCAL session_replication_role = replica;
    UPDATE hr.user_contracts
       SET employment_status = 'Full-Time', pay_basis = 'eba_security_annualised',
           remuneration_level = 4, contracted_weekly_hours = 38
     WHERE id = 'c0c00000-0000-4000-8000-000000000012';
    SET LOCAL session_replication_role = origin;

    SELECT * INTO sec_shift FROM jsonb_populate_record(NULL::public.shifts,
        (SELECT to_jsonb(s) FROM public.shifts s WHERE id = 'b1000000-0000-4000-8000-000000000001')
        || jsonb_build_object('shift_date', '2027-07-04', 'start_time', '07:00',
                              'net_length_minutes', 720, 'unpaid_break_minutes', 0,
                              'assigned_employee_id', 'a0000000-0000-4000-8000-000000000003',
                              'user_contract_id', 'c0c00000-0000-4000-8000-000000000012',
                              'target_employment_type', 'FT'));
    sec_before := public.fn_eba_shift_cost(sec_shift);
    sec_shift.shift_date := DATE '2027-07-06';
    sec_after := public.fn_eba_shift_cost(sec_shift);
    RAISE NOTICE 'Annualised security 12h (cap 12h vs 10h): ICC=% custom=%', sec_before, sec_after;

    -- 7. A card without loadings cannot be published and prices as NULL.
    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status)
    VALUES ('00000000-0000-0000-0000-000000000001', 'ICC-EA-BARE', 'No loadings', 'AUD', 'icc_sydney_ea', '2028-07-03', 'draft')
    RETURNING id INTO bare;
    INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source)
    SELECT bare, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source
      FROM public.eba_rate WHERE rate_card_id = src;

    RAISE NOTICE 'card without loadings prices as NULL: %',
        public.fn_eba_estimate_shift_cost('2028-07-06', '07:00', 420, 420, 34.64, 'Casual', false, false, false, false, NULL, 0, bare, 'AU-NSW') IS NULL;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.publish_rate_card(bare);
        RAISE NOTICE 'publish card without loadings: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'publish card without loadings: refused (%)', SQLSTATE;
    END;
    RESET ROLE;

    -- 8. Post-publish visibility & grants hygiene.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    RAISE NOTICE 'another organization sees published loadings: %',
        (SELECT count(*) FROM public.pay_rate_card_loadings WHERE rate_card_id = draft);
    RESET ROLE;

    RAISE NOTICE 'old helper signatures dropped: %',
        NOT EXISTS (
            SELECT 1 FROM pg_proc
             WHERE pronamespace = 'public'::regnamespace
               AND oid::regprocedure::text IN (
                   'fn_eba_penalty_loading(integer,boolean)',
                   'fn_eba_night_multiplier(integer,boolean)',
                   'fn_eba_min_engagement_minutes(text,boolean,boolean,boolean,boolean)'
               ));

    RAISE NOTICE 'anonymous callers: %',
        CASE WHEN has_function_privilege('anon', 'public.update_rate_card_loadings(uuid, jsonb)', 'EXECUTE')
               OR has_function_privilege('anon', 'public.fn_eba_penalty_loading(integer, boolean, public.pay_rate_card_loadings)', 'EXECUTE')
               OR has_function_privilege('anon', 'public.fn_eba_night_multiplier(integer, public.pay_rate_card_loadings)', 'EXECUTE')
               OR has_function_privilege('anon', 'public.fn_eba_min_engagement_minutes(text, boolean, boolean, boolean, boolean, public.pay_rate_card_loadings)', 'EXECUTE')
             THEN 'can call' ELSE 'cannot call' END;
END
$t$;

ROLLBACK;
