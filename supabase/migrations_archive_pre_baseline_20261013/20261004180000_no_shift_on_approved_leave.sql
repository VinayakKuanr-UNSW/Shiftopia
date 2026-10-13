-- Migration: 20261004180000_no_shift_on_approved_leave.sql
-- Description: An assigned shift is never created on, assigned to, moved onto or
--              PUBLISHED on a day the employee has approved leave.
--
-- HOW JAMES'S 5–9 OCT SHIFTS GOT PUBLISHED (2026-10-04)
-- ----------------------------------------------------
--   2026-10-01  the five shifts are created (no leave exists yet).
--   2026-10-03 21:06 UTC  annual leave 5–9 Oct is approved in the app. Approval
--               is supposed to delete the full-time shifts it collides with (D7)
--               — but `sm_delete_shift` was still broken (it archived through a
--               dropped table), so the approval succeeded and the shifts stayed.
--               Its fix (20261004120000) landed at 22:01 UTC, 55 minutes later.
--   2026-10-04 12:29 UTC  the 5 Oct shift is published from the roster card.
--
-- Nothing stopped that publish, because the leave check lives in only one
-- place: the Add Shift form's V8 rule `V8_LEAVE_CONFLICT` (BLOCKING), which
-- runs when a shift is created or edited. Publishing runs no leave check —
-- single publish is "a lifecycle transition only", and the bulk pre-check
-- covers overlap, weekly hours, rest and qualifications. Nor did the database.
--
-- THE RULE, ENFORCED ONCE, HERE
-- -----------------------------
-- Approved leave is a hard unavailability (it already blocks in the form, and
-- the solver excludes those dates). Judged when the pairing of a person and a
-- day is made or goes live:
--   * INSERT of an assigned shift;
--   * UPDATE that changes the assignee or the date;
--   * UPDATE that PUBLISHES the shift (lifecycle_status becomes 'Published').
-- Not judged: anything else on an existing shift, so a conflicting shift can
-- still be unpublished, unassigned or deleted — the ways out. A leave day is the
-- whole calendar day, as the leave cards, D7 and the V8 rule already treat it.
-- Applies to every employment type (D7 clears PT/Casual shifts too).
--
-- Bulk publish skips such shifts (it is one set-based UPDATE, so a refusal
-- would otherwise fail the whole roster), and the publish dialog reports them.
--
-- `start_date`/`end_date` hold the calendar date as UTC midnight — the form
-- submits `yyyy-MM-dd` — so the UTC date part is the leave day, as the client
-- readers (`loadLeaveDays`, `fetchV8EmployeeContext`) also take it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The predicate
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.employee_on_approved_leave(p_employee_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
          FROM public.leave_requests lr
         WHERE lr.employee_id = p_employee_id
           AND lr.status = 'approved'
           AND p_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date
                          AND (lr.end_date   AT TIME ZONE 'UTC')::date
    );
$function$;

-- Internal: called by the trigger and by sm_bulk_publish_shifts (both definer).
REVOKE ALL ON FUNCTION public.employee_on_approved_leave(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_on_approved_leave(uuid, date) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The guard
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_shift_not_on_approved_leave()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_type text;
    v_name text;
BEGIN
    IF NEW.assigned_employee_id IS NULL OR COALESCE(NEW.is_cancelled, false) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.assigned_employee_id IS NOT DISTINCT FROM NEW.assigned_employee_id
       AND OLD.shift_date           IS NOT DISTINCT FROM NEW.shift_date
       AND NOT (NEW.lifecycle_status = 'Published'
                AND OLD.lifecycle_status IS DISTINCT FROM 'Published') THEN
        RETURN NEW;
    END IF;

    SELECT lr.leave_type INTO v_type
      FROM public.leave_requests lr
     WHERE lr.employee_id = NEW.assigned_employee_id
       AND lr.status = 'approved'
       AND NEW.shift_date BETWEEN (lr.start_date AT TIME ZONE 'UTC')::date
                              AND (lr.end_date   AT TIME ZONE 'UTC')::date
     LIMIT 1;

    IF FOUND THEN
        SELECT NULLIF(trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
          INTO v_name FROM public.profiles WHERE id = NEW.assigned_employee_id;
        RAISE EXCEPTION '% is on approved % leave on %. Approved leave is a hard unavailability, so this shift cannot be assigned to them or published. Choose someone else, or remove the shift.',
            COALESCE(v_name, 'This employee'),
            replace(v_type, '_', ' '),
            to_char(NEW.shift_date, 'Dy FMDD Mon')
            USING ERRCODE = 'check_violation', HINT = 'ON_APPROVED_LEAVE';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_not_on_approved_leave ON public.shifts;
CREATE TRIGGER trg_shift_not_on_approved_leave
    BEFORE INSERT OR UPDATE OF assigned_employee_id, shift_date, lifecycle_status
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_not_on_approved_leave();

-- A trigger function is never called directly. Revoking EXECUTE does not stop it
-- firing (verified: the guard still refused a publish and a direct UPDATE run as
-- `authenticated`); it only clears the definer-executable advisor finding.
REVOKE ALL ON FUNCTION public.fn_shift_not_on_approved_leave() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bulk publish skips them. Production's body verbatim, plus `shift_date` in
--    shift_calculations and the leave exclusion in valid_transitions.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sm_bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_total_count int;
    v_success_count int;
    v_actor_name text;
    v_actor_role text;
BEGIN
    v_total_count := array_length(p_shift_ids, 1);

    IF p_actor_id IS NOT NULL THEN
        SELECT
            COALESCE(first_name || ' ' || COALESCE(last_name, ''), email),
            left(lower(legacy_system_role::text), 50)
        INTO v_actor_name, v_actor_role
        FROM profiles
        WHERE id = p_actor_id;
    ELSE
        v_actor_name := 'System';
        v_actor_role := 'system_automation';
    END IF;

    WITH shift_calculations AS (
        SELECT
            s.id,
            s.assigned_employee_id,
            s.shift_date,
            s.target_employment_type = 'FT' AS is_ft,
            get_shift_state_id(s.id) as current_state,
            COALESCE(s.scheduled_start, s.start_at) as shift_start_tz,
            get_time_category(COALESCE(s.scheduled_start, s.start_at)) as time_cat
        FROM shifts s
        WHERE s.id = ANY(p_shift_ids)
          AND s.deleted_at IS NULL
    ),
    valid_transitions AS (
        SELECT
            id,
            current_state,
            time_cat,
            CASE
                WHEN is_ft AND current_state = 'S2' THEN 'S4'
                WHEN is_ft THEN NULL
                WHEN current_state = 'S1' AND time_cat IN ('URGENT','NORMAL') THEN 'S5'
                WHEN current_state = 'S2' AND time_cat = 'EMERGENCY' THEN 'S4'
                WHEN current_state = 'S2' THEN 'S3'
                ELSE NULL
            END as new_state_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 4 THEN NOW()
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 24 THEN LEAST(NOW() + INTERVAL '4 hours', shift_start_tz - INTERVAL '4 hours')
                WHEN EXTRACT(EPOCH FROM (shift_start_tz - NOW())) / 3600.0 <= 48 THEN NOW() + INTERVAL '8 hours'
                ELSE NOW() + INTERVAL '12 hours'
            END as offer_deadline
        FROM shift_calculations
        WHERE current_state IN ('S1', 'S2')
          AND time_cat != 'PAST'
          AND NOT (current_state = 'S1' AND time_cat = 'EMERGENCY')
          -- Approved leave: an assigned shift is never published onto it.
          AND NOT (assigned_employee_id IS NOT NULL
                   AND public.employee_on_approved_leave(assigned_employee_id, shift_date))
    ),
    updated_rows AS (
        UPDATE shifts s
        SET
            lifecycle_status = 'Published',
            published_at = NOW(),
            last_modified_by = p_actor_id,
            updated_at = NOW(),
            bidding_status = CASE WHEN vt.new_state_id = 'S5' THEN 'on_bidding' ELSE s.bidding_status END,
            is_on_bidding = CASE WHEN vt.new_state_id = 'S5' THEN TRUE ELSE s.is_on_bidding END,
            bidding_open_at = CASE WHEN vt.new_state_id = 'S5' THEN NOW() ELSE s.bidding_open_at END,
            fulfillment_status = CASE
                WHEN vt.new_state_id = 'S5' THEN 'bidding'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S4' THEN 'scheduled'::shift_fulfillment_status
                WHEN vt.new_state_id = 'S3' THEN 'offered'::shift_fulfillment_status
                ELSE s.fulfillment_status
            END,
            assignment_outcome = CASE
                WHEN vt.new_state_id = 'S4' THEN 'confirmed'
                WHEN vt.new_state_id = 'S3' THEN NULL
                ELSE s.assignment_outcome
            END,
            confirmed_at = CASE WHEN vt.new_state_id = 'S4' THEN NOW() ELSE s.confirmed_at END,
            offer_sent_at = CASE WHEN vt.new_state_id = 'S3' THEN NOW() ELSE s.offer_sent_at END,
            offer_expires_at = CASE WHEN vt.new_state_id = 'S3' THEN vt.offer_deadline ELSE s.offer_expires_at END
        FROM valid_transitions vt
        WHERE s.id = vt.id AND vt.new_state_id IS NOT NULL
        RETURNING s.id, vt.current_state, vt.new_state_id, vt.offer_deadline
    ),
    offers_update AS (
        UPDATE public.shift_offers so
        SET offer_expires_at = ur.offer_deadline
        FROM updated_rows ur
        WHERE so.shift_id = ur.id
          AND ur.new_state_id = 'S3'
          AND so.status = 'Pending'
        RETURNING so.id
    )
    SELECT count(*) INTO v_success_count FROM updated_rows;

    RETURN jsonb_build_object(
        'success', true,
        'total_requested', v_total_count,
        'success_count', v_success_count,
        'failure_count', v_total_count - v_success_count,
        'message', format('Successfully published %s of %s shifts', v_success_count, v_total_count)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error in sm_bulk_publish_shifts: %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
