-- sm_delete_shift refuses shifts that have been worked. Approved 2026-10-01.
--
-- The function archived and deleted ANY shift — draft, published, or clocked
-- in and completed — and two code comments claimed it carried an "FSM guard"
-- it never had. Deleting a worked shift removes the clock-in and timesheet that
-- payroll pays from: hours someone really worked would drop out of pay (the
-- archive row keeps a copy, but nothing downstream reads it).
--
-- A shift counts as WORKED if it has a clock-in (`actual_start`) or is
-- In Progress / Completed — the same test the leave approval path uses
-- (`isWorkedShift`). Such a delete now returns
--   { success: false, code: 'SHIFT_WORKED', error: <reason> }
-- in the function's existing JSON shape, which `shiftsCommands.deleteShift`
-- already turns into a thrown Error the UI shows.
--
-- Scope: this function only. The direct `DELETE FROM shifts` paths (template
-- undo/cascade, subgroup delete, dead-shift cleanup, test helpers) are not
-- changed here. Body otherwise identical to the live definition; the existing
-- EXECUTE grant to `authenticated` is kept (the app calls it).

CREATE OR REPLACE FUNCTION public.sm_delete_shift(p_shift_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := COALESCE(p_user_id, auth.uid());

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'shift_id', p_shift_id,
      'error', 'Shift not found',
      'code', 'SHIFT_NOT_FOUND'
    );
  END IF;

  -- A worked shift carries the hours payroll pays from. Never delete it.
  IF v_shift.actual_start IS NOT NULL
     OR v_shift.lifecycle_status::text IN ('InProgress', 'Completed') THEN
    RETURN json_build_object(
      'success', false,
      'shift_id', p_shift_id,
      'error', 'This shift has been worked (clocked in, in progress or completed), so it cannot be deleted. Correct it through the timesheet instead.',
      'code', 'SHIFT_WORKED'
    );
  END IF;

  PERFORM public._archive_shift_before_delete(p_shift_id, v_actor_id, p_reason, 'sm_delete_shift');

  DELETE FROM public.shifts WHERE id = p_shift_id;

  RETURN json_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'message', 'Shift deleted successfully'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'shift_id', p_shift_id,
    'error', SQLERRM,
    'code', SQLSTATE
  );
END;
$function$;

-- Same ACL as before: the app (authenticated) and service role; never anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.sm_delete_shift(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sm_delete_shift(uuid, uuid, text) TO authenticated, service_role;
