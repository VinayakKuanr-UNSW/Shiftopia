-- No shift may start in the past, whichever path writes it.
--
-- Covers 20261028112606. Builds sm_create_shift payloads from one live
-- non-FT shift (unassigned) and checks, through the real creation path:
--   A. a start yesterday is refused (SHIFT_STARTED)
--   B. a start earlier today is refused (SHIFT_STARTED) — skipped in the
--      first minutes after midnight, when no earlier-today time exists
--   C. the source's own future slot is still accepted
--   D. moving that future shift to yesterday is refused (SHIFT_STARTED)
--   E. a second shift for the same roster + template instance is refused
--   F. apply_template_to_date_range_v2 no longer takes p_force_stack
--   G. sm_create_shift records the CALLER, not the p_user_id it was sent
-- Ends by raising, so every fixture is rolled back.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C D E F G
-- Last run: 2026-10-28 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_src     public.shifts%ROWTYPE;
  v_base    jsonb;
  v_today   date := (now() AT TIME ZONE 'Australia/Sydney')::date;
  v_id      uuid;
  v_admin   uuid;
  v_hint    text;
  v_msg     text;
  v_passed  text := '';
BEGIN
  SELECT * INTO v_src FROM public.shifts
  WHERE target_employment_type <> 'FT'
    AND (shift_date + start_time) AT TIME ZONE 'Australia/Sydney' > now() + interval '1 day'
  ORDER BY shift_date, start_time LIMIT 1;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: need one future non-FT shift';
  END IF;
  v_base := to_jsonb(v_src) - 'id' || jsonb_build_object('assigned_employee_id', NULL);

  -- A. yesterday
  BEGIN
    PERFORM public.sm_create_shift(v_base || jsonb_build_object('shift_date', v_today - 1), NULL);
    RAISE EXCEPTION 'FAILED (rolled back): A — a shift starting yesterday was created';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
    IF v_hint IS DISTINCT FROM 'SHIFT_STARTED' THEN
      RAISE EXCEPTION 'FAILED (rolled back): A — refused for another reason: %', v_msg;
    END IF;
    v_passed := v_passed || 'A ';
  END;

  -- B. earlier today
  IF (now() AT TIME ZONE 'Australia/Sydney')::time >= time '00:05' THEN
    BEGIN
      PERFORM public.sm_create_shift(v_base || jsonb_build_object(
        'shift_date', v_today, 'start_time', '00:00', 'end_time', '04:00'), NULL);
      RAISE EXCEPTION 'FAILED (rolled back): B — a shift starting earlier today was created';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
      IF v_hint IS DISTINCT FROM 'SHIFT_STARTED' THEN
        RAISE EXCEPTION 'FAILED (rolled back): B — refused for another reason: %', v_msg;
      END IF;
      v_passed := v_passed || 'B ';
    END;
  ELSE
    v_passed := v_passed || '(B skipped) ';
  END IF;

  -- C. the source's own future slot, as a template instance (for E)
  v_id := public.sm_create_shift(v_base || jsonb_build_object(
    'template_instance_id', gen_random_uuid()), NULL);
  v_passed := v_passed || 'C ';

  -- D. move it into the past
  BEGIN
    UPDATE public.shifts SET shift_date = v_today - 1 WHERE id = v_id;
    RAISE EXCEPTION 'FAILED (rolled back): D — a future shift was moved to yesterday';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
    IF v_hint IS DISTINCT FROM 'SHIFT_STARTED' THEN
      RAISE EXCEPTION 'FAILED (rolled back): D — refused for another reason: %', v_msg;
    END IF;
    v_passed := v_passed || 'D ';
  END;

  -- E. same roster + template instance again
  BEGIN
    PERFORM public.sm_create_shift(v_base || jsonb_build_object(
      'template_instance_id', (SELECT template_instance_id FROM public.shifts WHERE id = v_id)), NULL);
    RAISE EXCEPTION 'FAILED (rolled back): E — the same template instance was stamped twice on one roster';
  EXCEPTION WHEN unique_violation THEN
    v_passed := v_passed || 'E ';
  END;

  -- F. the opt-out is gone
  IF to_regprocedure('public.apply_template_to_date_range_v2(uuid,date,date,uuid,text,uuid,uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): F — apply_template_to_date_range_v2 still takes p_force_stack';
  END IF;
  v_passed := v_passed || 'F ';

  -- G. attribution, as an administrator naming someone else
  SELECT uc.user_id INTO v_admin FROM hr.user_contracts uc
  WHERE uc.access_level::text = 'zeta' LIMIT 1;
  IF v_admin IS NULL THEN
    v_passed := v_passed || '(G skipped: no administrator) ';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_id := public.sm_create_shift(v_base || jsonb_build_object('start_time', v_src.end_time,
      'end_time', (v_src.end_time + interval '4 hours')::time), gen_random_uuid());
    IF (SELECT created_by_user_id FROM public.shifts WHERE id = v_id) IS DISTINCT FROM v_admin THEN
      RAISE EXCEPTION 'FAILED (rolled back): G — created_by_user_id is the supplied id, not the caller';
    END IF;
    v_passed := v_passed || 'G';
  END IF;

  RAISE EXCEPTION 'PASSED (rolled back): %', btrim(v_passed);
END $$;
