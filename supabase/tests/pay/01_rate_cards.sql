-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Rate cards per period (migration *_rate_cards_per_period): roll forward a
-- draft, publish it, discard drafts — as Administrator (Z) only, in its own
-- organization; drafts stay hidden from everyone else. One line per case.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    z  constant uuid := 'a0000000-0000-4000-8000-000000000005';  -- zeta, organization O
    e  constant uuid := 'a0000000-0000-4000-8000-000000000004';  -- epsilon, organization O
    f  constant uuid := 'a0000000-0000-4000-8000-000000000008';  -- epsilon, the other organization
    x  constant uuid := 'a0000000-0000-4000-8000-000000000006';  -- employee, organization O
    src   uuid;
    draft uuid;
    clash uuid;
    n     int;
    shift public.shifts;
    before_cost numeric;
    after_cost  numeric;
BEGIN
    SELECT id INTO src FROM public.pay_rate_cards WHERE code = 'ICC-EA-2026-27';
    -- A Casual Level 2 shift on 2 August 2027, built in memory.
    SELECT * INTO shift FROM jsonb_populate_record(NULL::public.shifts,
        (SELECT to_jsonb(s) FROM public.shifts s WHERE id = 'b1000000-0000-4000-8000-000000000001')
        || jsonb_build_object('shift_date', '2027-08-02', 'start_time', '07:00',
                              'assigned_employee_id', x, 'user_contract_id', 'c0c00000-0000-4000-8000-000000000001',
                              'target_employment_type', ''));
    before_cost := public.fn_eba_shift_cost(shift);

    -- Only payroll.manage in the card's organization may roll it forward.
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN e ELSE f END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
            PERFORM public.roll_rate_card_forward(src, 'ICC-EA-2027-28', 'ICC Sydney EA 2027–28', '2027-07-05', 1.042);
            RAISE NOTICE '% rolls forward: allowed', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '% rolls forward: refused (%)', CASE n WHEN 1 THEN 'view-only (epsilon)' ELSE 'another organization' END, SQLSTATE;
        END;
        RESET ROLE;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.roll_rate_card_forward(src, 'BAD', 'Bad', '2027-07-05', 3);
        RAISE NOTICE 'multiplier 3: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'multiplier 3: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.roll_rate_card_forward(src, 'BAD', 'Bad', '2026-07-06', 1.042);
        RAISE NOTICE 'starting on its source''s date: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'starting on its source''s date: refused (%)', SQLSTATE;
    END;
    draft := public.roll_rate_card_forward(src, 'ICC-EA-2027-28', 'ICC Sydney EA 2027–28', '2027-07-05', 1.042);
    SELECT count(*) INTO n FROM public.pay_rate_cards WHERE id = draft AND status = 'draft';
    RAISE NOTICE 'Administrator rolls forward: draft % (%)', n, (SELECT derivation FROM public.pay_rate_cards WHERE id = draft);
    RESET ROLE;

    RAISE NOTICE 'every line scaled and rounded to cents: %', (
        SELECT bool_and(d.paid_hourly_rate = round(s.paid_hourly_rate * 1.042, 2)
                    AND d.ordinary_hourly_rate = round(s.ordinary_hourly_rate * 1.042, 2)) AND count(*) = 20
          FROM public.eba_rate d JOIN public.eba_rate s USING (classification, employment_basis)
         WHERE d.rate_card_id = draft AND s.rate_card_id = src)
        AND (SELECT bool_and(d.amount = round(s.amount * 1.042, 2)) AND count(*) = 4
               FROM public.eba_allowance d JOIN public.eba_allowance s USING (code)
              WHERE d.rate_card_id = draft AND s.rate_card_id = src);
    RAISE NOTICE 'trainee money scaled, Cert IV uplift %% kept: %', (
        SELECT (d.matrix #>> '{adult,ftWeekly,A,0}')::numeric = round((s.matrix #>> '{adult,ftWeekly,A,0}')::numeric * 1.042, 2)
           AND d.matrix -> 'certIvUpliftPct' = s.matrix -> 'certIvUpliftPct'
          FROM public.eba_trainee_schedule d, public.eba_trainee_schedule s
         WHERE d.rate_card_id = draft AND s.rate_card_id = src);

    -- Drafts are visible to the Administrator only, and price nothing.
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN x ELSE z END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        RAISE NOTICE '% sees the draft: % card(s), % rate(s)', CASE n WHEN 1 THEN 'employee' ELSE 'Administrator' END,
            (SELECT count(*) FROM public.pay_rate_cards WHERE id = draft),
            (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = draft);
        RESET ROLE;
    END LOOP;
    RAISE NOTICE 'a draft prices nothing: %', public.fn_eba_shift_cost(shift) = before_cost;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.publish_rate_card(draft);
    RESET ROLE;
    after_cost := public.fn_eba_shift_cost(shift);
    RAISE NOTICE 'published by the Administrator: %; the predecessor now ends %',
        (SELECT published_by = z FROM public.pay_rate_cards WHERE id = draft),
        (SELECT valid_to FROM public.pay_rate_cards WHERE id = src);
    RAISE NOTICE 'a 2 August 2027 shift is priced from it: % (x%)', after_cost > before_cost, round(after_cost / before_cost, 3);
    FOREACH n IN ARRAY ARRAY[1, 2] LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE n WHEN 1 THEN x ELSE f END, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        RAISE NOTICE '% sees ICC''s cards: %, rates on the new one: %', CASE n WHEN 1 THEN 'employee' ELSE 'another organization' END,
            (SELECT count(*) FROM public.pay_rate_cards WHERE code LIKE 'ICC-EA-%'),
            (SELECT count(*) FROM public.eba_rate WHERE rate_card_id = draft);
        RESET ROLE;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.publish_rate_card(draft);
        RAISE NOTICE 'publish twice: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'publish twice: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.discard_rate_card(draft);
        RAISE NOTICE 'discard a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'discard a published card: refused (%)', SQLSTATE;
    END;
    -- A card starting inside the 2026–27 period overlaps it.
    clash := public.roll_rate_card_forward(src, 'ICC-EA-MID', 'Mid-year', '2027-01-04', 1.01);
    BEGIN
        PERFORM public.publish_rate_card(clash);
        RAISE NOTICE 'overlapping card: published';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'overlapping card: refused (%)', SQLSTATE;
    END;
    PERFORM public.discard_rate_card(clash);
    RAISE NOTICE 'discard a draft: gone %', NOT EXISTS (SELECT 1 FROM public.pay_rate_cards WHERE id = clash);
    RESET ROLE;

    RAISE NOTICE 'anonymous callers: %', CASE WHEN has_function_privilege('anon', 'public.roll_rate_card_forward(uuid, text, text, date, numeric)', 'EXECUTE')
                                             OR has_function_privilege('anon', 'public.publish_rate_card(uuid)', 'EXECUTE')
                                             OR has_function_privilege('anon', 'public.discard_rate_card(uuid)', 'EXECUTE')
                                         THEN 'can call' ELSE 'cannot call' END;
END
$t$;
ROLLBACK;
