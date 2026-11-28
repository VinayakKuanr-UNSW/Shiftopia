-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Automated official public holiday verification (migration *_public_holidays_official_check;
-- docs/architecture/multi-organization.md §13): marks matches gazetted, inserts
-- newly proclaimed official dates (repricing shifts immediately), keeps
-- unconfirmed table-only dates for review without deleting them, notifies active
-- Administrators (zeta) of affected organizations once per finding, respects
-- advisory locks and grants. One line per case.
\set QUIET on
BEGIN;

DO $t$
DECLARE
    z     constant uuid := 'a0000000-0000-4000-8000-000000000005';  -- zeta, ICC Sydney (AU-NSW)
    x     constant uuid := 'a0000000-0000-4000-8000-000000000006';  -- employee, ICC Sydney
    src   uuid;
    base_nsw   jsonb;
    p_clean    jsonb;
    p_diff     jsonb;
    res        jsonb;
    cost_before numeric;
    cost_after  numeric;
    seen1       timestamptz;
    seen2       timestamptz;
    n_notifs    int;
BEGIN
    SELECT id INTO src FROM public.pay_rate_cards WHERE code = 'ICC-EA-2026-27';

    -- Snapshot AU-NSW 2026 from the seeded table as our baseline official list.
    SELECT jsonb_agg(jsonb_build_object('date', to_char(holiday_date, 'YYYY-MM-DD'), 'name', name) ORDER BY holiday_date)
      INTO base_nsw
      FROM public.public_holidays
     WHERE jurisdiction = 'AU-NSW' AND extract(year FROM holiday_date) = 2026;

    -- 1. Clean reconciliation + out-of-range year skipped: marks all 13 rows gazetted, 0 notifications.
    p_clean := jsonb_build_object('jurisdictions', jsonb_build_array(
        jsonb_build_object('jurisdiction', 'AU-NSW', 'year', 2026, 'source_url', 'https://www.nsw.gov.au/about-nsw/public-holidays', 'holidays', base_nsw),
        jsonb_build_object('jurisdiction', 'AU-NSW', 'year', 2023, 'source_url', 'https://data.gov.au/test', 'holidays', jsonb_build_array(jsonb_build_object('date', '2023-01-01', 'name', 'New Year''s Day')))
    ));
    res := public.reconcile_public_holidays(p_clean);
    RAISE NOTICE 'clean 2026 + skip 2023: checked=% matched=% off_only=% tbl_only=% name_diff=% notified=% skipped=%',
        res ->> 'checked', res ->> 'matched', res ->> 'official_only', res ->> 'table_only', res ->> 'name_differs', res ->> 'notified', res -> 'skipped';
    RAISE NOTICE 'AU-NSW 2026 all gazetted: %', (
        SELECT count(*) = 13 AND bool_and(source = 'gazetted' AND gazetted_at IS NOT NULL)
          FROM public.public_holidays WHERE jurisdiction = 'AU-NSW' AND extract(year FROM holiday_date) = 2026);

    -- 2. Discrepancy run:
    --    - official_only: 2026-09-22 National Day of Mourning (proclaimed one-off)
    --    - table_only: drop 2026-10-05 Labour Day from official list (simulates moved/dropped day)
    --    - name_differs: rename 2026-04-27 to 'Anzac Day (additional day)'
    cost_before := public.fn_eba_estimate_shift_cost('2026-09-22', '08:00', 480, 480, 32.39, 'FT', false, false, false, false, NULL, 0, src, 'AU-NSW');

    p_diff := jsonb_build_object('jurisdictions', jsonb_build_array(
        jsonb_build_object(
            'jurisdiction', 'AU-NSW',
            'year', 2026,
            'source_url', 'https://www.nsw.gov.au/about-nsw/public-holidays',
            'holidays', (
                SELECT jsonb_agg(
                    CASE WHEN h ->> 'date' = '2026-04-27'
                         THEN jsonb_build_object('date', '2026-04-27', 'name', 'Anzac Day (additional day)')
                         ELSE h END
                    ORDER BY h ->> 'date')
                  FROM (
                      SELECT h FROM jsonb_array_elements(base_nsw) h WHERE h ->> 'date' <> '2026-10-05'
                      UNION ALL
                      SELECT jsonb_build_object('date', '2026-09-22', 'name', 'National Day of Mourning')
                  ) q
            )
        )
    ));
    res := public.reconcile_public_holidays(p_diff);
    RAISE NOTICE 'diff run: matched=% off_only=% tbl_only=% name_diff=% notified=%',
        res ->> 'matched', res ->> 'official_only', res ->> 'table_only', res ->> 'name_differs', res ->> 'notified';

    -- Official-only row was inserted as gazetted and immediately repriced the shift at 2.5x.
    cost_after := public.fn_eba_estimate_shift_cost('2026-09-22', '08:00', 480, 480, 32.39, 'FT', false, false, false, false, NULL, 0, src, 'AU-NSW');
    RAISE NOTICE 'proclaimed day inserted as gazetted: %, shift repriced: % -> %',
        EXISTS (SELECT 1 FROM public.public_holidays WHERE jurisdiction = 'AU-NSW' AND holiday_date = '2026-09-22' AND source = 'gazetted'),
        cost_before, cost_after;

    -- Table-only row is kept (never silently deleted) and demoted back to 'rule'.
    RAISE NOTICE 'table_only kept and demoted to rule: %',
        EXISTS (SELECT 1 FROM public.public_holidays WHERE jurisdiction = 'AU-NSW' AND holiday_date = '2026-10-05' AND source = 'rule' AND gazetted_at IS NULL);

    -- Notification reached ICC Sydney's zeta admin (Z) and mentions both findings.
    SELECT count(*) INTO n_notifs
      FROM public.notifications
     WHERE profile_id = z AND entity_type = 'public_holidays'
       AND message LIKE '%National Day of Mourning%' AND message LIKE '%Labour Day%';
    RAISE NOTICE 'ICC Administrator notified once: %', n_notifs;

    SELECT first_seen_at INTO seen1
      FROM public.public_holiday_discrepancies
     WHERE jurisdiction = 'AU-NSW' AND holiday_date = '2026-10-05' AND kind = 'table_only';

    -- 3. Re-running the exact same payload is idempotent: official_only cleared,
    --    table_only first_seen_at preserved, 0 notifications sent.
    res := public.reconcile_public_holidays(p_diff);
    SELECT first_seen_at INTO seen2
      FROM public.public_holiday_discrepancies
     WHERE jurisdiction = 'AU-NSW' AND holiday_date = '2026-10-05' AND kind = 'table_only';
    RAISE NOTICE 're-run idempotent: off_only=% tbl_only=% notified=% first_seen_preserved=%',
        res ->> 'official_only', res ->> 'table_only', res ->> 'notified', (seen1 = seen2);

    -- 4. Validation rejects unknown jurisdictions and mismatched years.
    BEGIN
        PERFORM public.reconcile_public_holidays('{"jurisdictions": [{"jurisdiction": "AU-NOPE", "year": 2026, "source_url": "https://x", "holidays": []}]}'::jsonb);
        RAISE NOTICE 'unknown jurisdiction: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unknown jurisdiction: refused (%)', SQLSTATE;
    END;
    BEGIN
        PERFORM public.reconcile_public_holidays('{"jurisdictions": [{"jurisdiction": "AU-NSW", "year": 2026, "source_url": "https://x", "holidays": [{"date": "2027-01-01", "name": "Wrong year"}]}]}'::jsonb);
        RAISE NOTICE 'wrong holiday year: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'wrong holiday year: refused (%)', SQLSTATE;
    END;

    -- 5. RLS & privilege checks: authenticated reads checks/discrepancies, cannot execute RPC; anon gets nothing.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    RAISE NOTICE 'authenticated reads checks=% discrepancies=%',
        (SELECT count(*) FROM public.public_holiday_checks WHERE jurisdiction = 'AU-NSW' AND year = 2026),
        (SELECT count(*) FROM public.public_holiday_discrepancies WHERE jurisdiction = 'AU-NSW');
    RESET ROLE;

    RAISE NOTICE 'RPC grants: anon=% authenticated=% service_role=%',
        has_function_privilege('anon', 'public.reconcile_public_holidays(jsonb)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.reconcile_public_holidays(jsonb)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.reconcile_public_holidays(jsonb)', 'EXECUTE');
    RAISE NOTICE 'anon table select: checks=% discrepancies=%',
        has_table_privilege('anon', 'public.public_holiday_checks', 'SELECT'),
        has_table_privilege('anon', 'public.public_holiday_discrepancies', 'SELECT');
END
$t$;

ROLLBACK;
