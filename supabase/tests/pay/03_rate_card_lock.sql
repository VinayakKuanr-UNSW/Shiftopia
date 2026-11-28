-- Needs only the reference seed (ICC Sydney's two published cards); everything rolls back.
-- Published rate cards are immutable (migration *_rate_card_published_lock;
-- multi-organization.md §11.1 R12). Every probe writes as the database owner,
-- so only the triggers can refuse it; the RPC paths (roll forward, publish,
-- discard) are proven still to work by 01_rate_cards.sql. One line per case.
-- Before the migration every "refused (55000)" line read "allowed" (or failed
-- on a later constraint with another SQLSTATE).
\set QUIET on
BEGIN;

DO $t$
DECLARE
    org   constant uuid := '00000000-0000-0000-0000-000000000001';
    old25 uuid;  -- ICC-EA-2025, published, closed
    icc26 uuid;  -- ICC-EA-2026-27, published, open-ended
    draft uuid;
BEGIN
    SELECT id INTO old25 FROM public.pay_rate_cards WHERE code = 'ICC-EA-2025';
    SELECT id INTO icc26 FROM public.pay_rate_cards WHERE code = 'ICC-EA-2026-27';

    -- 1. A published card's lines.
    BEGIN
        UPDATE public.eba_rate SET paid_hourly_rate = paid_hourly_rate + 1 WHERE rate_card_id = icc26;
        RAISE NOTICE 'edit a published rate: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'edit a published rate: refused (%)', SQLSTATE;
    END;
    BEGIN
        INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source)
        VALUES (icc26, 'LEVEL_8', 'permanent', 50, 50, 'probe');
        RAISE NOTICE 'add a rate to a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'add a rate to a published card: refused (%)', SQLSTATE;
    END;
    BEGIN
        DELETE FROM public.eba_allowance WHERE rate_card_id = old25;
        RAISE NOTICE 'delete a published allowance: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'delete a published allowance: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_card_loadings SET saturday_loading = 0.30 WHERE rate_card_id = icc26;
        RAISE NOTICE 'edit published loadings: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'edit published loadings: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.eba_trainee_schedule SET label = 'probe' WHERE rate_card_id = icc26;
        RAISE NOTICE 'edit a published trainee schedule: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'edit a published trainee schedule: refused (%)', SQLSTATE;
    END;

    -- 2. A published card itself.
    BEGIN
        UPDATE public.pay_rate_cards SET valid_from = valid_from - 1 WHERE id = icc26;
        RAISE NOTICE 'move a published card''s start: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'move a published card''s start: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_cards SET valid_to = valid_to - 1 WHERE id = old25;
        RAISE NOTICE 'move a closed card''s end: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'move a closed card''s end: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_cards SET code = 'ICC-RENAMED' WHERE id = icc26;
        RAISE NOTICE 'rename a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rename a published card: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_cards SET status = 'draft' WHERE id = icc26;
        RAISE NOTICE 'unpublish a card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unpublish a card: refused (%)', SQLSTATE;
    END;
    BEGIN
        DELETE FROM public.eba_rate WHERE rate_card_id = old25;
        DELETE FROM public.eba_allowance WHERE rate_card_id = old25;
        DELETE FROM public.eba_trainee_schedule WHERE rate_card_id = old25;
        DELETE FROM public.pay_rate_card_loadings WHERE rate_card_id = old25;
        DELETE FROM public.pay_rate_cards WHERE id = old25;
        RAISE NOTICE 'delete a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'delete a published card: refused (%)', SQLSTATE;
    END;

    -- 3. Drafts stay writable, and publishing still works.
    INSERT INTO public.pay_rate_cards (organization_id, code, name, currency, rule_set, valid_from, status)
    VALUES (org, 'ICC-LOCK-PROBE', 'Lock probe', 'AUD', 'icc_sydney_ea', '2027-07-05', 'draft')
    RETURNING id INTO draft;
    BEGIN
        INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source)
        SELECT draft, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source
          FROM public.eba_rate WHERE rate_card_id = icc26;
        INSERT INTO public.eba_allowance (rate_card_id, code, amount, unit, source)
        SELECT draft, code, amount, unit, source FROM public.eba_allowance WHERE rate_card_id = icc26;
        INSERT INTO public.eba_rate (rate_card_id, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source)
        VALUES (draft, 'LEVEL_8', 'permanent', 50, 50, 'probe');
        UPDATE public.eba_rate SET paid_hourly_rate = paid_hourly_rate + 1 WHERE rate_card_id = draft;
        DELETE FROM public.eba_allowance WHERE rate_card_id = draft AND code = (
            SELECT min(code) FROM public.eba_allowance WHERE rate_card_id = draft);
        RAISE NOTICE 'add, edit and delete a draft''s lines: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'add, edit and delete a draft''s lines: refused (%)', SQLSTATE;
    END;
    -- Lines whose (classification, basis) the target lacks, so only the lock can refuse.
    BEGIN
        UPDATE public.eba_rate SET rate_card_id = icc26 WHERE rate_card_id = draft AND classification = 'LEVEL_8';
        RAISE NOTICE 'move a draft''s line onto a published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'move a draft''s line onto a published card: refused (%)', SQLSTATE;
    END;
    BEGIN
        DELETE FROM public.eba_rate WHERE rate_card_id = draft AND classification = 'LEVEL_1' AND employment_basis = 'casual';
        UPDATE public.eba_rate SET rate_card_id = draft
         WHERE rate_card_id = icc26 AND classification = 'LEVEL_1' AND employment_basis = 'casual';
        RAISE NOTICE 'move a published line onto a draft: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'move a published line onto a draft: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_cards SET valid_to = DATE '2027-01-31' WHERE id = icc26;
        RAISE NOTICE 'close the open-ended card where no card follows: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'close the open-ended card where no card follows: refused (%)', SQLSTATE;
    END;
    -- What publish_rate_card does: close the open-ended predecessor, then publish.
    BEGIN
        UPDATE public.pay_rate_cards SET valid_to = DATE '2027-07-04' WHERE id = icc26;
        UPDATE public.pay_rate_cards SET status = 'published', published_at = now() WHERE id = draft;
        RAISE NOTICE 'close the open-ended card and publish the draft: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'close the open-ended card and publish the draft: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.eba_rate SET paid_hourly_rate = paid_hourly_rate + 1 WHERE rate_card_id = draft;
        RAISE NOTICE 'edit the just-published card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'edit the just-published card: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.pay_rate_cards SET valid_to = NULL WHERE id = icc26;
        RAISE NOTICE 'reopen a closed card: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reopen a closed card: refused (%)', SQLSTATE;
    END;

    -- 4. Break-glass, transaction-local.
    BEGIN
        PERFORM set_config('pay.rate_card_lock', 'off', true);
        UPDATE public.eba_rate SET source = source WHERE rate_card_id = icc26;
        PERFORM set_config('pay.rate_card_lock', '', true);
        RAISE NOTICE 'pay.rate_card_lock = off lets maintenance through: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pay.rate_card_lock = off lets maintenance through: refused (%)', SQLSTATE;
    END;
    BEGIN
        UPDATE public.eba_rate SET source = source WHERE rate_card_id = icc26;
        RAISE NOTICE 'after resetting it: allowed';
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'after resetting it: refused (%)', SQLSTATE;
    END;

    -- 5. The trigger functions are not callable by clients.
    RAISE NOTICE 'clients: %', CASE
        WHEN has_function_privilege('authenticated', 'public.fn_rate_card_line_published_lock()', 'EXECUTE')
          OR has_function_privilege('anon', 'public.fn_rate_card_line_published_lock()', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.fn_rate_card_published_lock()', 'EXECUTE')
          OR has_function_privilege('anon', 'public.fn_rate_card_published_lock()', 'EXECUTE')
        THEN 'can call' ELSE 'cannot call' END;
END
$t$;

ROLLBACK;
