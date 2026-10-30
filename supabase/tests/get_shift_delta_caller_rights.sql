-- get_shift_delta returns only shifts the caller may read.
--
-- It was SECURITY DEFINER with no caller check, so any signed-in user could
-- read every shift of any organisation (dates, times, assignee) by passing its
-- id. It now runs with the caller's rights, so shifts' RLS applies exactly as
-- it does to the list queries whose caches the delta patches. Checks:
--   A. an employee gets no row they could not SELECT from shifts themselves
--      (precondition: RLS hides at least one shift from them)
--   B. a manager of a sub-department that has shifts gets exactly the shifts
--      they can SELECT themselves, and at least one
-- Ends by raising, so nothing persists.
--
-- Expected output (as the error text):  PASSED (rolled back): A B
-- Last run: 2026-10-30 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  c_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  v_emp     uuid;
  v_mgr     uuid;
  v_total   integer;
  v_visible integer;
  v_leaked  integer;
  v_rows    integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.shifts WHERE organization_id = c_org;

  SELECT uc.user_id INTO v_emp FROM hr.user_contracts uc
  WHERE uc.organization_id = c_org AND uc.access_level = 'alpha' AND uc.status = 'Active'
  ORDER BY uc.user_id LIMIT 1;
  SELECT uc.user_id INTO v_mgr FROM hr.user_contracts uc
  WHERE uc.organization_id = c_org AND uc.access_level = 'gamma' AND uc.status = 'Active'
    AND uc.sub_department_id IN (SELECT sub_department_id FROM public.shifts WHERE organization_id = c_org)
  ORDER BY uc.user_id LIMIT 1;
  IF v_emp IS NULL OR v_mgr IS NULL OR v_total = 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): fixture — need an alpha user, a gamma user and shifts';
  END IF;

  -- A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible FROM public.shifts WHERE organization_id = c_org;
  SELECT count(*) INTO v_leaked
  FROM public.get_shift_delta(c_org, '-infinity'::timestamptz) d
  WHERE NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = d.id);
  EXECUTE 'RESET ROLE';
  IF v_visible >= v_total THEN
    RAISE EXCEPTION 'FAILED (rolled back): fixture — employee % can already see all % shifts', v_emp, v_total;
  END IF;
  IF v_leaked > 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — employee got % shift(s) RLS hides from them', v_leaked;
  END IF;

  -- B
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible FROM public.shifts WHERE organization_id = c_org;
  SELECT count(*) INTO v_rows FROM public.get_shift_delta(c_org, '-infinity'::timestamptz);
  EXECUTE 'RESET ROLE';
  IF v_rows = 0 OR v_rows <> v_visible THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — manager got % shift(s), can see %', v_rows, v_visible;
  END IF;

  RAISE EXCEPTION 'PASSED (rolled back): A B';
END
$$;
