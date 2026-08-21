-- ============================================================================
-- Phase 7 — a request for availability names a JOB, and only that job's
-- declaration closes it.
--
-- `availability_requests.sub_department_id` landed in 20260821090000 alongside
-- the other four availability tables, but the trigger that auto-closes a
-- request never learned about it. So a manager asking "please declare your
-- Set-up availability" was answered by a Security declaration: the employee
-- declares for a job the manager was not asking about, the request flips to
-- 'responded', and the manager stops chasing something that was never
-- provided. The failure is silent and it is on the reporting side, which is
-- the worst combination — the record says the loop closed.
--
-- The scope predicate is the SAME truth table as `scopeFilter` in the client
-- and `_slot_in_scope` in the solver, deliberately:
--
--   * a request with NULL scope was asked person-wide, so ANY declaration
--     answers it — that is every one of the requests on file today;
--   * a rule with NULL scope covers every job the employee holds, so it
--     answers any request;
--   * otherwise they must match.
--
-- Both NULL arms keep the existing single production row behaving exactly as
-- it does now. This migration is inert until a scoped request is written.
--
-- The function is the ONLY thing that changes. The trigger, table, indexes and
-- RLS from 20260809000100 are untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_availability_rule_closes_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rule_end date;
BEGIN
    v_rule_end := COALESCE(NEW.repeat_end_date, NEW.start_date);

    UPDATE public.availability_requests r
       SET status            = 'responded',
           responded_at      = now(),
           responded_rule_id = NEW.id
     WHERE r.profile_id = NEW.profile_id
       AND r.status     = 'pending'
       -- Interval overlap, inclusive on both ends.
       AND NEW.start_date <= r.period_end
       AND v_rule_end     >= r.period_start
       -- …and the declaration has to be about the job that was asked for.
       AND (
                r.sub_department_id IS NULL
             OR NEW.sub_department_id IS NULL
             OR r.sub_department_id = NEW.sub_department_id
           );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_availability_rule_closes_request() IS
    'Marks pending availability_requests as responded when the employee declares a rule overlapping the requested period FOR THE REQUESTED SUB-DEPARTMENT. A NULL scope on either side matches everything (see 20260821100000).';

-- `CREATE OR REPLACE FUNCTION` PRESERVES the existing ACL, so the revokes this
-- function already carries are intact and are NOT re-applied here. Restating
-- them would be the only way to change them, and nothing about this change
-- should widen who may execute it.

-- ── Self-test ───────────────────────────────────────────────────────────────
-- Server-side subtransaction: a client-side BEGIN/ROLLBACK does not roll back
-- through the migration runner, but a DO block that RAISEs at the end does.
--
-- The fixture is DERIVED from production contracts rather than invented,
-- because two Phase 1/2 guards stand between this and the insert:
-- `trg_availability_scope_is_contracted` requires an Active contract in the
-- sub-department being declared for, and `trg_prevent_ft_availability_rule`
-- refuses a Full-Time one. A made-up (profile, sub-department) pair would be
-- rejected by the first and the test would report the wrong failure.
DO $selftest$
DECLARE
    v_profile   uuid;
    v_manager   uuid;
    v_job_a     uuid;
    v_job_b     uuid;
    v_req       uuid;
    v_status    text;
BEGIN
    -- Someone holding non-Full-Time Active contracts in at least TWO
    -- sub-departments — the population this whole workstream is about.
    SELECT user_id INTO v_profile
      FROM public.user_contracts
     WHERE status = 'Active'
       AND sub_department_id IS NOT NULL
       AND employment_status::text NOT ILIKE '%full%'  -- enum, not text
     GROUP BY user_id
    HAVING count(DISTINCT sub_department_id) >= 2
     LIMIT 1;

    IF v_profile IS NULL THEN
        RAISE NOTICE 'selftest skipped — no multi-sub-department non-FT contract holder on file';
        RETURN;
    END IF;

    -- PG17 has no min()/max() aggregate for uuid; array_agg is the workaround.
    SELECT (array_agg(DISTINCT sub_department_id))[1],
           (array_agg(DISTINCT sub_department_id))[2]
      INTO v_job_a, v_job_b
      FROM public.user_contracts
     WHERE user_id = v_profile
       AND status = 'Active'
       AND sub_department_id IS NOT NULL
       AND employment_status::text NOT ILIKE '%full%';  -- enum, not text

    SELECT id INTO v_manager FROM public.profiles ORDER BY id LIMIT 1;

    -- A request scoped to job A.
    INSERT INTO public.availability_requests
        (profile_id, requested_by, period_start, period_end, sub_department_id)
    VALUES (v_profile, v_manager, DATE '2099-01-05', DATE '2099-01-20', v_job_a)
    RETURNING id INTO v_req;

    -- A job-B declaration overlapping the same period must NOT close it. This
    -- is the defect: before the scope predicate, it did.
    INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
    VALUES (v_profile, DATE '2099-01-06', '09:00', '17:00', 'none', v_job_b);

    SELECT status INTO v_status FROM public.availability_requests WHERE id = v_req;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'selftest FAILED: an out-of-scope declaration closed the request (status=%)', v_status;
    END IF;
    RAISE NOTICE 'ok: an out-of-scope declaration leaves the request pending';

    -- A job-A declaration must close it.
    INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
    VALUES (v_profile, DATE '2099-01-07', '09:00', '17:00', 'none', v_job_a);

    SELECT status INTO v_status FROM public.availability_requests WHERE id = v_req;
    IF v_status <> 'responded' THEN
        RAISE EXCEPTION 'selftest FAILED: the in-scope declaration did not close the request (status=%)', v_status;
    END IF;
    RAISE NOTICE 'ok: the in-scope declaration closes the request';

    -- An UNSCOPED request is answered by anything — the state of every request
    -- on file today, and the reason this migration is inert until a scoped one
    -- is written.
    INSERT INTO public.availability_requests
        (profile_id, requested_by, period_start, period_end, sub_department_id)
    VALUES (v_profile, v_manager, DATE '2099-02-05', DATE '2099-02-20', NULL)
    RETURNING id INTO v_req;

    INSERT INTO public.availability_rules
        (profile_id, start_date, start_time, end_time, repeat_type, sub_department_id)
    VALUES (v_profile, DATE '2099-02-06', '09:00', '17:00', 'none', v_job_b);

    SELECT status INTO v_status FROM public.availability_requests WHERE id = v_req;
    IF v_status <> 'responded' THEN
        RAISE EXCEPTION 'selftest FAILED: a person-wide request was not closed by a scoped declaration (status=%)', v_status;
    END IF;
    RAISE NOTICE 'ok: a person-wide request is still closed by any declaration';

    RAISE EXCEPTION 'selftest_rollback';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'selftest_rollback' THEN
            RAISE NOTICE 'availability_request_scope selftest PASSED (rolled back)';
        ELSE
            RAISE;
        END IF;
END
$selftest$;
