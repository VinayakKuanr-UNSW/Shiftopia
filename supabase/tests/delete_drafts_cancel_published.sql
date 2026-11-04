-- Delete drafts, cancel published (docs/design/shift-trading/03-bidding-fsm.md B-D13..B-D16).
--
--   * delete: S1/S2 only; a published shift is refused (SHIFT_PUBLISHED), singly and in bulk
--   * sm_cancel_shift: S3-S7, and S8 while nobody has clocked in; a note is required;
--     the assignee and any trade partner are notified; never logged against the
--     employee (no CANCELLED / LATE_CANCELLED); a pending offer row expires
--   * gateway publish: FT goes straight to S4; a started shift is refused
-- It ends by raising, so the fixture rows are always rolled back.
--
-- Expected output (as the error text):
--   del-draft true; del-published SHIFT_PUBLISHED; bulk-published Published — cancel it instead;
--   cancel-draft ILLEGAL_STATE; cancel-no-note REASON_REQUIRED;
--   cancel-S4 S10 emp-events 0 op 1 notified 1; cancel-S3 Expired;
--   cancel-S6 S10 offer CANCELLED partner S4 notified 1; cancel-S8 S10; cancel-S8-punched SHIFT_WORKED;
--   gw-ft S4; gw-started SHIFT_STARTED
-- Before the migration: sm_cancel_shift does not exist.

CREATE FUNCTION pg_temp.p4_shift(t record, d date, st time, en time, emp uuid, lc text, outcome text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_roster uuid; v_sub uuid; v_id uuid; v_ft boolean := t.target = 'FT';
BEGIN
  SELECT r.id INTO v_roster FROM public.rosters r
   WHERE r.department_id = t.department_id AND r.sub_department_id = t.sub_department_id
     AND d BETWEEN r.start_date AND r.end_date LIMIT 1;
  SELECT rs.id INTO v_sub FROM public.roster_subgroups rs JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
   WHERE rg.roster_id = v_roster AND (rg.external_id ILIKE '%office%') = v_ft ORDER BY rs.id LIMIT 1;
  INSERT INTO public.shifts (roster_id, roster_subgroup_id, organization_id, department_id, sub_department_id, role_id,
         target_employment_type, shift_date, start_time, end_time,
         paid_break_minutes, unpaid_break_minutes, break_start, break_end,
         lifecycle_status, assignment_status, assigned_employee_id, assignment_outcome,
         bidding_status, fulfillment_status, is_cancelled)
  VALUES (v_roster, v_sub, t.organization_id, t.department_id, t.sub_department_id, t.role_id, t.target,
          d, st, en,
          CASE WHEN v_ft THEN 30 ELSE 0 END, CASE WHEN v_ft THEN 30 ELSE 0 END,
          CASE WHEN v_ft THEN st + interval '4 hours' END, CASE WHEN v_ft THEN st + interval '4 hours 30 minutes' END,
          lc::public.shift_lifecycle,
          CASE WHEN emp IS NULL THEN 'unassigned' ELSE 'assigned' END::public.shift_assignment_status,
          emp, outcome::public.shift_assignment_outcome,
          CASE WHEN lc = 'Published' AND emp IS NULL THEN 'on_bidding' ELSE 'not_on_bidding' END::public.shift_bidding_status,
          CASE WHEN lc <> 'Published' THEN 'none' WHEN emp IS NULL THEN 'bidding' WHEN outcome IS NULL THEN 'offered' ELSE 'scheduled' END::public.shift_fulfillment_status,
          false)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  t record; ft record;
  a uuid; b uuid;
  draft uuid; bid uuid; conf uuid; conf2 uuid; offered uuid; posted uuid; partner uuid;
  live uuid; punched uuid; ft_draft uuid; past_draft uuid;
  sw uuid;
  -- a Monday ~30 days out, so d1..d1+2 are weekdays (weekend shifts have longer minimums)
  d1 date := (now() AT TIME ZONE 'Australia/Sydney')::date + 30
             + ((8 - extract(isodow FROM (now() AT TIME ZONE 'Australia/Sydney')::date + 30)::int) % 7);
  r jsonb; rj json;
  res text := '';
BEGIN
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id,
         public.fn_normalize_employment_type(uc.employment_status::text) AS target,
         (array_agg(DISTINCT uc.user_id))[1:2] AS emps
    INTO t
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text) IS DISTINCT FROM 'FT'
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND o.shift_date BETWEEN d1 - 2 AND d1 + 2)
     AND EXISTS (SELECT 1 FROM public.rosters r WHERE r.department_id = uc.department_id
                    AND r.sub_department_id = uc.sub_department_id AND d1 BETWEEN r.start_date AND r.end_date)
   GROUP BY 1, 2, 3, 4, 5
  HAVING count(DISTINCT uc.user_id) >= 2
   LIMIT 1;
  SELECT uc.organization_id, uc.department_id, uc.sub_department_id, uc.role_id, 'FT'::text AS target,
         (array_agg(DISTINCT uc.user_id))[1] AS emp
    INTO ft
    FROM hr.user_contracts uc
   WHERE uc.status = 'Active' AND uc.sub_department_id IS NOT NULL AND uc.role_id IS NOT NULL
     AND public.fn_normalize_employment_type(uc.employment_status::text) = 'FT'
     AND NOT EXISTS (SELECT 1 FROM public.shifts o WHERE o.assigned_employee_id = uc.user_id
                      AND o.shift_date BETWEEN d1 - 2 AND d1 + 2)
     AND EXISTS (SELECT 1 FROM public.rosters r WHERE r.department_id = uc.department_id
                    AND r.sub_department_id = uc.sub_department_id AND d1 BETWEEN r.start_date AND r.end_date)
   GROUP BY 1, 2, 3, 4, 5
   LIMIT 1;
  IF t IS NULL OR ft IS NULL THEN RAISE EXCEPTION 'SKIPPED: need a rostered casual/PT team and an FT holder'; END IF;
  a := t.emps[1]; b := t.emps[2];

  draft    := pg_temp.p4_shift(t, d1, '06:00', '09:00', NULL, 'Draft', NULL);
  bid      := pg_temp.p4_shift(t, d1, '06:00', '09:00', NULL, 'Published', NULL);
  conf     := pg_temp.p4_shift(t, d1, '09:30', '12:30', a, 'Published', 'confirmed');
  conf2    := pg_temp.p4_shift(t, d1, '13:00', '16:00', a, 'Published', 'confirmed');
  offered  := pg_temp.p4_shift(t, d1, '16:30', '19:30', a, 'Published', NULL);
  posted   := pg_temp.p4_shift(t, d1 + 1, '06:00', '09:00', a, 'Published', 'confirmed');
  partner  := pg_temp.p4_shift(t, d1 + 1, '13:00', '16:00', b, 'Published', 'confirmed');
  live     := pg_temp.p4_shift(t, d1 + 2, '06:00', '09:00', b, 'Published', 'confirmed');
  punched  := pg_temp.p4_shift(t, d1 + 2, '13:00', '16:00', a, 'Published', 'confirmed');
  ft_draft := pg_temp.p4_shift(ft, d1, '09:00', '17:30', ft.emp, 'Draft', NULL);
  past_draft := pg_temp.p4_shift(t, d1 + 2, '17:00', '20:00', NULL, 'Draft', NULL);
  INSERT INTO public.shift_offers (shift_id, employee_id, status, offer_expires_at)
  VALUES (offered, a, 'Pending', now() + interval '1 day');

  -- live and punched are in progress; past_draft has started
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET lifecycle_status = 'InProgress', start_at = now() - interval '10 minutes' WHERE id IN (live, punched);
  UPDATE public.timesheets SET clock_in = now() - interval '9 minutes' WHERE shift_id = punched;
  UPDATE public.shifts SET start_at = now() - interval '1 minute' WHERE id = past_draft;
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', '', true);

  -- delete
  rj := public.sm_delete_shift(draft);
  res := concat(res, 'del-draft ', rj->>'success', '; ');
  rj := public.sm_delete_shift(bid);
  res := concat(res, 'del-published ', rj->>'code', '; ');
  r := public.sm_bulk_delete_shifts(ARRAY[conf2]);
  res := concat(res, 'bulk-published ', r->'failed'->0->>'reason', '; ');

  -- cancel
  r := public.sm_cancel_shift(past_draft, 'test');
  res := concat(res, 'cancel-draft ', r->>'code', '; ');
  r := public.sm_cancel_shift(conf, '   ');
  res := concat(res, 'cancel-no-note ', r->>'code', '; ');
  r := public.sm_cancel_shift(conf, 'Event cancelled by client');
  res := concat(res, 'cancel-S4 ', public.get_shift_state_id(conf),
    ' emp-events ', (SELECT count(*) FROM public.shift_events WHERE shift_id = conf AND event_type IN ('CANCELLED', 'LATE_CANCELLED')),
    ' op ', (SELECT count(*) FROM public.shift_events WHERE shift_id = conf AND event_type = 'OP_APPLIED'
               AND metadata->>'op' = 'cancel' AND metadata->>'note' = 'Event cancelled by client'),
    ' notified ', (SELECT count(*) FROM public.notifications WHERE profile_id = a AND entity_id = conf AND type = 'shift_cancelled'), '; ');
  r := public.sm_cancel_shift(offered, 'Over-staffed');
  res := concat(res, 'cancel-S3 ', (SELECT status FROM public.shift_offers WHERE shift_id = offered), '; ');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  sw := (public.sm_create_swap_request(posted)->>'swap_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM public.sm_submit_swap_offer(sw, partner);
  PERFORM set_config('request.jwt.claims', '', true);
  r := public.sm_cancel_shift(posted, 'Venue closed');
  res := concat(res, 'cancel-S6 ', public.get_shift_state_id(posted),
    ' offer ', (SELECT status FROM public.swap_offers WHERE swap_request_id = sw),
    ' partner ', public.get_shift_state_id(partner),
    ' notified ', (SELECT count(*) FROM public.notifications WHERE profile_id = b AND entity_id = posted AND type = 'shift_cancelled'), '; ');

  r := public.sm_cancel_shift(live, 'Sent home: power outage');
  res := concat(res, 'cancel-S8 ', public.get_shift_state_id(live), '; ');
  r := public.sm_cancel_shift(punched, 'Sent home');
  res := concat(res, 'cancel-S8-punched ', r->>'code', '; ');

  -- gateway publish
  r := public.sm_apply_shift_op(ft_draft, (SELECT version FROM public.shifts WHERE id = ft_draft), 'publish', '{}'::jsonb);
  res := concat(res, 'gw-ft ', coalesce(r->>'note', public.get_shift_state_id(ft_draft)), '; ');
  r := public.sm_apply_shift_op(past_draft, (SELECT version FROM public.shifts WHERE id = past_draft), 'publish', '{}'::jsonb);
  res := concat(res, 'gw-started ', coalesce(r->>'note', public.get_shift_state_id(past_draft)));

  RAISE EXCEPTION '%', res;
END $$;
