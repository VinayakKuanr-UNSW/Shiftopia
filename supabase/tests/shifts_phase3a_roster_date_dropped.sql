-- shifts Phase 3a: roster_date is gone and nothing writes it.
--
-- Covers the shifts_phase3a_drop_roster_date migration. Checks:
--   A. shifts has no roster_date column and no index names it
--   B. no function in any schema names roster_date
--   C. sm_create_shift still creates a shift from a payload that carries a
--      stray roster_date (an old client), and sm_move_shift still moves it
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C

DO $$
DECLARE
  v_names  text;
  v_passed text := '';
  v_actor  uuid;
  v_pay    jsonb;
  v_new    uuid;
  v_date   date;
BEGIN
  -- A
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass
             AND attname = 'roster_date' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — shifts still has roster_date';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'shifts'
             AND indexdef ~ '\mroster_date\M') THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — an index still names roster_date';
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_names
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~ '\mroster_date\M';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — still names roster_date: %', v_names;
  END IF;
  v_passed := v_passed || 'B ';

  -- C: copy a future shift's placement into a new one, then move it a day.
  SELECT s.assigned_employee_id,
         jsonb_build_object('roster_id', s.roster_id, 'department_id', s.department_id,
           'organization_id', s.organization_id, 'sub_department_id', s.sub_department_id,
           'role_id', s.role_id, 'group_type', s.group_type, 'sub_group_name', s.sub_group_name,
           'shift_subgroup_id', s.roster_subgroup_id, 'target_employment_type', s.target_employment_type,
           'timezone', s.timezone, 'shift_date', s.shift_date + 2, 'start_time', '12:00', 'end_time', '16:00',
           'paid_break_minutes', 15, 'roster_date', '1999-01-01')
    INTO v_actor, v_pay
  FROM public.shifts s
  WHERE s.start_at > now() + interval '2 days' AND NOT s.is_cancelled AND s.assigned_employee_id IS NOT NULL
  ORDER BY s.start_at LIMIT 1;
  IF v_pay IS NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — no future shift to copy a placement from';
  END IF;
  v_new := public.sm_create_shift(v_pay, v_actor)::text::uuid;
  PERFORM public.sm_move_shift(v_new, NULL, NULL, NULL, NULL, ((v_pay->>'shift_date')::date + 1), v_actor);
  SELECT shift_date INTO v_date FROM public.shifts WHERE id = v_new;
  IF v_date IS DISTINCT FROM (v_pay->>'shift_date')::date + 1 THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — moved shift is on %, expected %', v_date, (v_pay->>'shift_date')::date + 1;
  END IF;
  v_passed := v_passed || 'C';

  RAISE EXCEPTION 'PASSED (rolled back): %', v_passed;
END $$;
