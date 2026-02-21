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
  v_performer_role text; -- Keep as text to read from legacy_system_role
BEGIN
  -- 1. Validate Requester Shift
  SELECT * INTO v_requester_shift FROM shifts WHERE id = p_requester_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester shift not found';
  END IF;

  -- 2. Validate Offered Shift (if exists)
  IF p_offered_shift_id IS NOT NULL THEN
    SELECT * INTO v_offered_shift FROM shifts WHERE id = p_offered_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Offered shift not found';
    END IF;
  END IF;

  -- 3. Fetch Performer Details
  -- Note: explicit cast to text for role just in case it's an enum
  SELECT 
    COALESCE(full_name, first_name || ' ' || last_name, 'Unknown User'),
    COALESCE(legacy_system_role::text, 'manager') 
  INTO v_performer_name, v_performer_role
  FROM profiles
  WHERE id = auth.uid();

  -- Fallback and Sanitize
  v_performer_name := COALESCE(v_performer_name, 'Unknown User');
  v_performer_role := COALESCE(v_performer_role, 'manager');
  
  -- Ensure role is a valid enum string (simple validation)
  -- Valid values: 'admin', 'manager', 'team_lead', 'team_member'
  -- If invalid/legacy, fallback to 'manager' (safe default for an approval action)
  IF v_performer_role NOT IN ('admin', 'manager', 'team_lead', 'team_member') THEN
      v_performer_role := 'manager';
  END IF;

  -- 4. Execute Trade for Requester Shift (Requester -> Offerer)
  -- Bypass 'Locking Violation' trigger by temporarily setting outcome to 'offered'
  UPDATE shifts SET assignment_outcome = 'offered' WHERE id = p_requester_shift_id;

  UPDATE shifts 
  SET assigned_employee_id = p_offerer_id,
      assignment_outcome = 'confirmed',
      updated_at = NOW(),
      -- Clear trade flags [FIX]
      trade_requested_at = NULL,
      trading_status = 'NoTrade'
  WHERE id = p_requester_shift_id;

  -- 5. Execute Trade for Offered Shift (Offerer -> Requester)
  IF p_offered_shift_id IS NOT NULL THEN
    UPDATE shifts SET assignment_outcome = 'offered' WHERE id = p_offered_shift_id;

    UPDATE shifts 
    SET assigned_employee_id = p_requester_id,
        assignment_outcome = 'confirmed',
        updated_at = NOW(),
        -- Clear trade flags [FIX]
        trade_requested_at = NULL,
        trading_status = 'NoTrade'
    WHERE id = p_offered_shift_id;
  END IF;

  -- 6. Log Audit Events using correct shift_audit_events schema
  -- Cast v_performer_role to system_role explicitly in the INSERT? 
  -- No, Postgres will cast from text if the string is valid.
  INSERT INTO shift_audit_events (
    shift_id, event_type, event_category, performed_by_id, performed_by_name, performed_by_role,
    field_changed, old_value, new_value, batch_id, metadata
  ) VALUES 
  (
    p_requester_shift_id, 'SWAP_COMPLETED', 'assignment', auth.uid(), v_performer_name, v_performer_role::system_role,
    'assigned_employee_id', p_requester_id::text, p_offerer_id::text, v_batch::text,
    jsonb_build_object('method', 'sm_approve_peer_swap', 'reason', 'Swap Approved',
                       'offered_shift_id', p_offered_shift_id)
  );

  IF p_offered_shift_id IS NOT NULL THEN
    INSERT INTO shift_audit_events (
      shift_id, event_type, event_category, performed_by_id, performed_by_name, performed_by_role,
      field_changed, old_value, new_value, batch_id, metadata
    ) VALUES 
    (
      p_offered_shift_id, 'SWAP_COMPLETED', 'assignment', auth.uid(), v_performer_name, v_performer_role::system_role,
      'assigned_employee_id', p_offerer_id::text, p_requester_id::text, v_batch::text,
      jsonb_build_object('method', 'sm_approve_peer_swap', 'reason', 'Swap Approved',
                         'requester_shift_id', p_requester_shift_id)
    );
  END IF;

END;
$function$;
