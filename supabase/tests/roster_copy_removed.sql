-- Rosters has no copy; a template shift has no employee.
--
-- Covers 20261029051734_remove_roster_copy_and_template_assignment. Checks:
--   A. clone_roster_subgroup_v2 no longer exists
--   B. template_shifts has no assigned_employee_id / assigned_employee_name
--   C. v_template_full returns no employee keys, still returns the break
--      window, still runs as the caller (security_invoker) with its grants
--   D. applying a template stamps every shift unassigned, in S1
-- Ends by raising, so every fixture is rolled back.
--
-- Expected output (as the error text):  PASSED (rolled back): A B C D
-- Last run: 2026-10-29 against Supabase dev — FAILED before the migration, PASSED after.

DO $$
DECLARE
  v_tpl     uuid;
  v_shift   json;
  v_from    date := (now() AT TIME ZONE 'Australia/Sydney')::date + 70;
  v_result  jsonb;
  v_bad     integer;
  v_passed  text := '';
BEGIN
  -- A
  IF to_regprocedure('public.clone_roster_subgroup_v2(uuid,uuid,uuid,text,text,text,date,date,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): A — clone_roster_subgroup_v2 still exists';
  END IF;
  v_passed := v_passed || 'A ';

  -- B
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'template_shifts'
               AND column_name IN ('assigned_employee_id', 'assigned_employee_name')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): B — template_shifts still has an employee column';
  END IF;
  v_passed := v_passed || 'B ';

  -- C
  SELECT s INTO v_shift
  FROM public.v_template_full t,
       json_array_elements(t.groups) g,
       json_array_elements(g->'subGroups') sg,
       json_array_elements(sg->'shifts') s
  WHERE s->>'breakStart' IS NOT NULL
  LIMIT 1;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — no template shift with a break window came back from v_template_full';
  END IF;
  IF (v_shift::jsonb) ?| ARRAY['assignedEmployeeId', 'assignedEmployeeName'] THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — v_template_full still returns an employee: %', v_shift;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_template_full'::regclass
                 AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — v_template_full lost security_invoker';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.v_template_full', 'SELECT')
          AND has_table_privilege('anon', 'public.v_template_full', 'SELECT')) THEN
    RAISE EXCEPTION 'FAILED (rolled back): C — v_template_full lost a SELECT grant';
  END IF;
  v_passed := v_passed || 'C ';

  -- D: apply a template with shifts, as the system, ten weeks out
  SELECT t.id INTO v_tpl
  FROM public.roster_templates t
  JOIN public.template_groups g ON g.template_id = t.id
  JOIN public.template_subgroups sg ON sg.group_id = g.id
  JOIN public.template_shifts ts ON ts.subgroup_id = sg.id
  GROUP BY t.id ORDER BY count(*) DESC LIMIT 1;
  IF v_tpl IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: need one template with shifts';
  END IF;
  v_result := public.apply_template_to_date_range_v2(v_tpl, v_from, v_from + 6, NULL, 'roster_modal', NULL, NULL);
  IF COALESCE((v_result->>'shifts_created')::int, 0) = 0 THEN
    RAISE EXCEPTION 'SKIPPED: the template stamped nothing on % – % (%).', v_from, v_from + 6, v_result;
  END IF;
  SELECT count(*) INTO v_bad FROM public.shifts
  WHERE template_batch_id = (v_result->>'batch_id')::uuid
    AND (assigned_employee_id IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — % applied shift(s) came with an employee', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM public.shift_events e
  JOIN public.shifts s ON s.id = e.shift_id
  WHERE s.template_batch_id = (v_result->>'batch_id')::uuid
    AND e.metadata->>'source' = 'apply_template_to_date_range_v2'
    AND (e.employee_id IS NOT NULL OR e.metadata->>'to_state' <> 'S1');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAILED (rolled back): D — % creation event(s) name an employee or a state other than S1', v_bad;
  END IF;
  v_passed := v_passed || 'D';

  RAISE EXCEPTION 'PASSED (rolled back): %', btrim(v_passed);
END $$;
