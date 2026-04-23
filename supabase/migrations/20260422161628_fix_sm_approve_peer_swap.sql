CREATE OR REPLACE FUNCTION public.sm_approve_peer_swap(p_requester_shift_id uuid, p_offered_shift_id uuid, p_requester_id uuid, p_offerer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_requester_shift shifts%ROWTYPE;
  v_offered_shift shifts%ROWTYPE;
  v_batch uuid := gen_random_uuid();
  v_performer_name text;
  v_performer_role text; 
BEGIN
  SELECT * INTO v_requester_shift FROM shifts WHERE id = p_requester_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester shift not found';
  END IF;

  IF p_offered_shift_id IS NOT NULL THEN
    SELECT * INTO v_offered_shift FROM shifts WHERE id = p_offered_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Offered shift not found';
    END IF;
  END IF;

  SELECT 
    COALESCE(full_name, first_name || ' ' || last_name, 'Unknown User'),
    COALESCE(legacy_system_role::text, 'manager') 
  INTO v_performer_name, v_performer_role
  FROM profiles
  WHERE id = auth.uid();

  v_performer_name := COALESCE(v_performer_name, 'Unknown User');
  v_performer_role := COALESCE(v_performer_role, 'manager');
  
  IF v_performer_role NOT IN ('admin', 'manager', 'team_lead', 'team_member') THEN
      v_performer_role := 'manager';
  END IF;

  -- Update requester shift to confirmed with the new offerer.
  -- Notice: We no longer do an interim state change to 'offered' because it violates
  -- the v3 shift state machine constraint for `Published` shifts.
  UPDATE shifts 
  SET assigned_employee_id = p_offerer_id,
      assignment_outcome = 'confirmed',
      updated_at = NOW(),
      trade_requested_at = NULL,
      trading_status = 'NoTrade'
  WHERE id = p_requester_shift_id;

  IF p_offered_shift_id IS NOT NULL THEN
    UPDATE shifts 
    SET assigned_employee_id = p_requester_id,
        assignment_outcome = 'confirmed',
        updated_at = NOW(),
        trade_requested_at = NULL,
        trading_status = 'NoTrade'
    WHERE id = p_offered_shift_id;
  END IF;
END;
$function$
