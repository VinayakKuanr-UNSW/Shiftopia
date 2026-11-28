-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Rate card authoring (migration *_rate_card_authoring; multi-organization.md
-- §11.1 R8/R9): an Administrator (payroll.manage = zeta in the card's
-- organization) creates a card from scratch, edits its meta, rates,
-- allowances and trainee schedule, bulk-adjusts rates, copies cards and lines,
-- and publishes it. Every write is draft-only and gated per organization. One
-- line per case.
\set QUIET on
BEGIN;

DO $t$
DECLARE
    z     constant uuid := 'a0000000-0000-4000-8000-000000000005';  -- zeta, organization O
    e     constant uuid := 'a0000000-0000-4000-8000-000000000004';  -- epsilon, organization O
    f     constant uuid := 'a0000000-0000-4000-8000-000000000008';  -- epsilon, the other organization
    org   constant uuid := '00000000-0000-0000-0000-000000000001';  -- O (ICC Sydney)
    other constant uuid := '00000000-0000-0000-0000-0000000000f2';  -- the other organization
    src   uuid;
    blank uuid;
    cp    uuid;
    n     int;
BEGIN
    SELECT id INTO src FROM public.pay_rate_cards WHERE code = 'ICC-EA-2026-27';

    -- 1. Create a card from scratch.
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN e ELSE f END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
            PERFORM public.create_rate_card(org, 'NOPE', 'Nope', '2028-07-03');
            RAISE NOTICE '% creates a card: allowed', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '% creates a card: refused (%)', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END, SQLSTATE;
        END;
        RESET ROLE;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.create_rate_card(org, 'BAD', 'Bad', '2028-07-03', 'aud');
        RAISE NOTICE 'currency aud: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'currency aud: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.create_rate_card(org, 'BAD', 'Bad', '2028-07-03', 'AUD', 'some_other_agreement');
        RAISE NOTICE 'unknown rule set: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unknown rule set: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.create_rate_card(org, '  ', 'Bad', '2028-07-03');
        RAISE NOTICE 'blank code: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'blank code: refused (%)', SQLSTATE;
    END;
    blank := public.create_rate_card(org, 'ICC-NEW', 'New agreement', '2028-07-03', 'AUD', 'icc_sydney_ea', 'FWC approval pending');
    BEGIN
        PERFORM public.publish_rate_card(blank);
        RAISE NOTICE 'publish a card with no rates: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'publish a card with no rates: refused (%)', SQLSTATE;
    END;
    RESET ROLE;
    RAISE NOTICE 'Administrator creates a card: %, % rate(s), notes %',
        (SELECT status FROM public.pay_rate_cards WHERE id = blank),
        (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = blank),
        (SELECT notes FROM public.pay_rate_cards WHERE id = blank);
    RAISE NOTICE 'it starts with the rule set''s default loadings (= ICC''s seeded card): %', (
        SELECT (to_jsonb(b) - 'rate_card_id' - 'created_at' - 'updated_at') = (to_jsonb(s) - 'rate_card_id' - 'created_at' - 'updated_at')
          FROM public.pay_rate_card_loadings b, public.pay_rate_card_loadings s
         WHERE b.rate_card_id = blank AND s.rate_card_id = src);

    -- 2. Meta.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.update_rate_card_meta(blank, jsonb_build_object(
        'name', 'ICC Sydney EA 2028–29', 'valid_from', '2028-07-10', 'notes', 'FWC approved', 'award_floor_checked', true));
    BEGIN
        PERFORM public.update_rate_card_meta(blank, '{"status": "published"}');
        RAISE NOTICE 'meta: set status: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'meta: set status: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.update_rate_card_meta(src, '{"notes": "x"}');
        RAISE NOTICE 'meta of a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'meta of a published card: refused (%)', SQLSTATE;
    END;
    RESET ROLE;
    RAISE NOTICE 'meta updated: %', (
        SELECT name = 'ICC Sydney EA 2028–29' AND valid_from = DATE '2028-07-10' AND notes = 'FWC approved'
               AND award_floor_checked_at IS NOT NULL
          FROM public.pay_rate_cards WHERE id = blank);

    -- 3. Rates.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    n := public.upsert_rate_card_rates(blank, '[
        {"classification": "LEVEL_1", "employment_basis": "permanent", "ordinary_hourly_rate": 30},
        {"classification": "LEVEL_1", "employment_basis": "casual", "ordinary_hourly_rate": 30, "notes": "Sch 2 §1"},
        {"classification": "LEVEL_2", "employment_basis": "casual", "ordinary_hourly_rate": 31}]');
    RAISE NOTICE 'upsert 3 rates: %', n;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_1", "employment_basis": "casual", "ordinary_hourly_rate": 30, "paid_hourly_rate": 40}]');
        RAISE NOTICE 'casual paid off the casual-loading formula: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'casual paid off the casual-loading formula: refused (%)', SQLSTATE;
    END;
    PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_1", "employment_basis": "casual", "ordinary_hourly_rate": 30, "paid_hourly_rate": 40, "is_manual_override": true, "notes": "Sch 2 §1"}]');
    PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_1", "employment_basis": "casual", "ordinary_hourly_rate": 30}]');
    RAISE NOTICE 'editing an override line without a paid rate keeps the manual rate: %', (
        SELECT paid_hourly_rate = 40 FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_1' AND employment_basis = 'casual');
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_3", "employment_basis": "permanent", "ordinary_hourly_rate": 0.004}]');
        RAISE NOTICE 'rate 0.004 (0.00 in cents): allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rate 0.004 (0.00 in cents): refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_3", "employment_basis": "permanent", "ordinary_hourly_rate": 1000000}]');
        RAISE NOTICE 'rate 1000000: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rate 1000000: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_3", "employment_basis": "permanent", "ordinary_hourly_rate": 0}]');
        RAISE NOTICE 'rate 0: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rate 0: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_3", "employment_basis": "weekly", "ordinary_hourly_rate": 30}]');
        RAISE NOTICE 'basis weekly: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'basis weekly: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "level 3", "employment_basis": "permanent", "ordinary_hourly_rate": 30}]');
        RAISE NOTICE 'classification "level 3": allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'classification "level 3": refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "SECURITY_LEVEL_3", "employment_basis": "annualised", "ordinary_hourly_rate": 30}]');
        RAISE NOTICE 'annualised without a paid rate: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'annualised without a paid rate: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_rates(src, '[{"classification": "LEVEL_1", "employment_basis": "permanent", "ordinary_hourly_rate": 99}]');
        RAISE NOTICE 'rates of a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rates of a published card: refused (%)', SQLSTATE;
    END;
    RESET ROLE;
    RAISE NOTICE 'permanent paid = ordinary, casual paid = ordinary × (1 + casual loading): %',
        (SELECT paid_hourly_rate = 30 FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_1' AND employment_basis = 'permanent')
        AND (SELECT paid_hourly_rate = 38.75 FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_2' AND employment_basis = 'casual');
    RAISE NOTICE 'manual override kept with its flag and note: %', (
        SELECT paid_hourly_rate = 40 AND is_manual_override AND notes = 'Sch 2 §1'
          FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_1' AND employment_basis = 'casual');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.upsert_rate_card_rates(blank, '[{"classification": "LEVEL_3", "employment_basis": "permanent", "ordinary_hourly_rate": 30}]');
        RAISE NOTICE 'view-only (epsilon) edits a rate: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'view-only (epsilon) edits a rate: refused (%)', SQLSTATE;
    END;
    RESET ROLE;

    -- 4. Bulk adjust: scales both rates; a formula-derived casual rate is re-derived.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    RAISE NOTICE 'bulk adjust LEVEL_2 × 1.1: % line(s)', public.bulk_adjust_rate_card_rates(blank, ARRAY['LEVEL_2'], 1.1);
    BEGIN
        PERFORM public.bulk_adjust_rate_card_rates(blank, NULL, 3);
        RAISE NOTICE 'bulk adjust × 3: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bulk adjust × 3: refused (%)', SQLSTATE;
    END;
    RESET ROLE;
    RAISE NOTICE 'LEVEL_2 casual now % / %, LEVEL_1 untouched: %',
        (SELECT ordinary_hourly_rate FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_2'),
        (SELECT paid_hourly_rate FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_2'),
        (SELECT bool_and(ordinary_hourly_rate = 30) FROM public.eba_rate WHERE rate_card_id = blank AND classification = 'LEVEL_1');

    -- 5. Allowances, removal, trainee schedule, loadings.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    RAISE NOTICE 'upsert allowances: %', public.upsert_rate_card_allowances(blank, '[
        {"code": "meal", "amount": 20.5, "unit": "per_occasion", "notes": "cl 28.1"},
        {"code": "split_shift", "amount": 8, "unit": "per_shift"}]');
    BEGIN
        PERFORM public.upsert_rate_card_allowances(blank, '[{"code": "meal", "amount": -1, "unit": "per_occasion"}]');
        RAISE NOTICE 'allowance -1: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'allowance -1: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.upsert_rate_card_allowances(blank, '[{"code": "meal", "amount": 20, "unit": "per_fortnight"}]');
        RAISE NOTICE 'allowance unit per_fortnight: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'allowance unit per_fortnight: refused (%)', SQLSTATE;
    END;
    RAISE NOTICE 'remove one rate and one allowance: %', public.delete_rate_card_items(blank,
        '[{"classification": "LEVEL_2", "employment_basis": "casual"}]', ARRAY['split_shift']);
    PERFORM public.update_rate_card_trainee_schedule(blank,
        (SELECT matrix FROM public.eba_trainee_schedule WHERE rate_card_id = src), 'ICC 2028–29 trainees', 'Sch 5');
    BEGIN
        PERFORM public.update_rate_card_trainee_schedule(blank, '[1, 2]', 'x', 'x');
        RAISE NOTICE 'trainee matrix not an object: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'trainee matrix not an object: refused (%)', SQLSTATE;
    END;
    PERFORM public.update_rate_card_loadings(blank, '{"sws_min_weekly": 95}');
    RESET ROLE;
    RAISE NOTICE 'lines now: % rate(s), allowances %, trainee schedule %, SWS minimum %',
        (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = blank),
        (SELECT string_agg(code || '=' || amount, ',' ORDER BY code) FROM public.eba_allowance WHERE rate_card_id = blank),
        (SELECT label FROM public.eba_trainee_schedule WHERE rate_card_id = blank),
        (SELECT sws_min_weekly FROM public.pay_rate_card_loadings WHERE rate_card_id = blank);

    -- 6. Copy a card, and copy lines between cards.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    cp := public.copy_rate_card(src, NULL, 'ICC-COPY', 'Copy', '2029-07-02');
    RESET ROLE;
    RAISE NOTICE 'copy: every line and the loadings, derivation %: %',
        (SELECT derivation FROM public.pay_rate_cards WHERE id = cp), (
        (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = cp) = (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = src)
        AND (SELECT count(*) FROM public.eba_allowance WHERE rate_card_id = cp) = (SELECT count(*) FROM public.eba_allowance WHERE rate_card_id = src)
        AND EXISTS (SELECT 1 FROM public.eba_trainee_schedule WHERE rate_card_id = cp)
        AND (SELECT to_jsonb(c) - 'rate_card_id' - 'created_at' - 'updated_at' FROM public.pay_rate_card_loadings c WHERE c.rate_card_id = cp)
          = (SELECT to_jsonb(s) - 'rate_card_id' - 'created_at' - 'updated_at' FROM public.pay_rate_card_loadings s WHERE s.rate_card_id = src));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    cp := public.copy_rate_card(src, NULL, 'ICC-COPY-2', 'Copy 2', '2029-07-02', '{"allowances": false, "trainee": false, "multiplier": 1.05}');
    BEGIN
        PERFORM public.copy_rate_card(src, other, 'X', 'X', '2029-07-02');
        RAISE NOTICE 'copy into an organization where the caller is not Administrator: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'copy into an organization where the caller is not Administrator: refused (%)', SQLSTATE;
    END;
    RESET ROLE;
    RAISE NOTICE 'copy with options: rates scaled %, allowances %, trainee schedule %', (
        SELECT bool_and(d.paid_hourly_rate = round(s.paid_hourly_rate * 1.05, 2)) AND count(*) = 20
          FROM public.eba_rate d JOIN public.eba_rate s USING (classification, employment_basis)
         WHERE d.rate_card_id = cp AND s.rate_card_id = src),
        (SELECT count(*) FROM public.eba_allowance WHERE rate_card_id = cp),
        (SELECT count(*) FROM public.eba_trainee_schedule WHERE rate_card_id = cp);

    -- Administrator of both organizations: the copy lands in the other one.
    INSERT INTO hr.user_contracts (id, user_id, role_id, organization_id, department_id, sub_department_id, status, employment_status, pay_basis, remuneration_level, contracted_weekly_hours, access_level)
    VALUES ('c0c00000-0000-4000-8000-0000000000f9', z, 'e0000000-0000-4000-8000-000000000001', other,
            'd2000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'Active', 'Casual', 'eba_level', 2, 0, 'zeta');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    cp := public.copy_rate_card(src, other, 'OTHER-EA', 'Other EA', '2026-07-06');
    RESET ROLE;
    RAISE NOTICE 'Administrator of both copies into the other organization: %, still a draft: %',
        (SELECT organization_id = other FROM public.pay_rate_cards WHERE id = cp),
        (SELECT status = 'draft' FROM public.pay_rate_cards WHERE id = cp);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    RAISE NOTICE 'copy LEVEL_3 lines and split_shift into the new card: %',
        public.copy_rate_card_items(blank, src, ARRAY['LEVEL_3'], ARRAY['split_shift'])
        = (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = src AND classification = 'LEVEL_3') + 1;
    BEGIN
        PERFORM public.copy_rate_card_items(src, blank, ARRAY['LEVEL_1'], NULL);
        RAISE NOTICE 'copy lines into a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'copy lines into a published card: refused (%)', SQLSTATE;
    END;

    -- 7. The authored card publishes, closing ICC's open-ended card.
    PERFORM public.publish_rate_card(blank);
    RESET ROLE;
    RAISE NOTICE 'authored card published: %; ICC-EA-2026-27 now ends %',
        (SELECT status FROM public.pay_rate_cards WHERE id = blank),
        (SELECT valid_to FROM public.pay_rate_cards WHERE id = src);

    -- 8. Roll forward keeps each line's note and override flag.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    cp := public.roll_rate_card_forward(blank, 'ICC-NEXT', 'Next', '2029-07-09', 1.03);
    RESET ROLE;
    RAISE NOTICE 'roll forward keeps notes and overrides: %', (
        SELECT is_manual_override AND notes = 'Sch 2 §1'
          FROM public.eba_rate WHERE rate_card_id = cp AND classification = 'LEVEL_1' AND employment_basis = 'casual');

    RAISE NOTICE 'anonymous callers: %', CASE WHEN
        has_function_privilege('anon', 'public.create_rate_card(uuid, text, text, date, text, text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.update_rate_card_meta(uuid, jsonb)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.upsert_rate_card_rates(uuid, jsonb)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.upsert_rate_card_allowances(uuid, jsonb)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.delete_rate_card_items(uuid, jsonb, text[])', 'EXECUTE')
        OR has_function_privilege('anon', 'public.update_rate_card_trainee_schedule(uuid, jsonb, text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.bulk_adjust_rate_card_rates(uuid, text[], numeric)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.copy_rate_card(uuid, uuid, text, text, date, jsonb)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.copy_rate_card_items(uuid, uuid, text[], text[])', 'EXECUTE')
        THEN 'can call' ELSE 'cannot call' END;
END
$t$;

ROLLBACK;
