-- Migration: Fix Roster JSON Sync for Swaps
-- Date: 2026-02-11
-- Description: Adds a sync function to update roster JSON blobs when shifts change, and integrates it into the swap approval RPC.

BEGIN;

-- 1. Create Sync Function
-- This function finds the roster containing the shift and updates its JSON blob
CREATE OR REPLACE FUNCTION sync_roster_shift_assignment(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift_details RECORD;
  v_roster_id uuid;
  v_roster_groups jsonb;
  v_new_groups jsonb;
BEGIN
  -- 1. Get shift details (date, department, assignment)
  SELECT 
    date, 
    department_id, 
    assigned_employee_id,
    id
  INTO v_shift_details
  FROM shifts
  WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RETURN; -- Shift doesn't exist, nothing to sync
  END IF;

  -- 2. Find the matching roster
  SELECT id, groups
  INTO v_roster_id, v_roster_groups
  FROM rosters
  WHERE department_id = v_shift_details.department_id
    AND date = v_shift_details.date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN; -- No roster exists for this shift, nothing to sync
  END IF;

  -- 3. Update the JSON blob
  -- We need to iterate through groups -> subGroups -> shifts to find the matching shift ID
  -- AND update its status and assigned employee.
  -- Since iterating and modifying deep JSONB arrays in pure SQL is painful and error-prone,
  -- we will use a CTE with jsonb_path_query or a simpler approach if possible.
  -- Given the complexity, a JS-like approach using jsonb_set with a path is best IF we know the path.
  -- But we don't know the indices.
  
  -- Alternative: Use a PL/pgSQL loop to reconstruct the JSON.
  
  -- Let's try a direct JSONB update using a transformation if possible, or a plpgsql loop.
  -- For stability, we'll parse the json, find the path, and update.
  
  WITH found_path AS (
    SELECT 
        g.ord - 1 as group_idx,
        sg.ord - 1 as subgroup_idx,
        s.ord - 1 as shift_idx
    FROM jsonb_array_elements(v_roster_groups) WITH ORDINALITY g(elem, ord),
         jsonb_array_elements(g.elem->'subGroups') WITH ORDINALITY sg(elem, ord),
         jsonb_array_elements(sg.elem->'shifts') WITH ORDINALITY s(elem, ord)
    WHERE (s.elem->>'id')::uuid = p_shift_id
  )
  SELECT 
    group_idx, subgroup_idx, shift_idx
  INTO 
    v_new_groups -- Using this variable temporarily to store indices won't match type, using DECLARE variables instead
  FROM found_path;
  
  -- Re-declare variables for indices
  DECLARE
    v_g_idx int;
    v_sg_idx int;
    v_s_idx int;
  BEGIN
    SELECT group_idx, subgroup_idx, shift_idx 
    INTO v_g_idx, v_sg_idx, v_s_idx
    FROM (
        SELECT 
            g.ord - 1 as group_idx,
            sg.ord - 1 as subgroup_idx,
            s.ord - 1 as shift_idx
        FROM jsonb_array_elements(v_roster_groups) WITH ORDINALITY g(elem, ord),
             jsonb_array_elements(g.elem->'subGroups') WITH ORDINALITY sg(elem, ord),
             jsonb_array_elements(sg.elem->'shifts') WITH ORDINALITY s(elem, ord)
        WHERE (s.elem->>'id') = p_shift_id::text
    ) sub;
    
    IF v_g_idx IS NOT NULL THEN
      -- Construct the update path
      -- Update assignment field
      -- Update employeeId field (legacy)
      -- Update status field
      
      -- We update the whole shift object at that path to merge the new values
      -- Or safer: update specific fields.
      
      v_new_groups := v_roster_groups;
      
      -- 1. Update employeeId (Legacy but used by UI)
      v_new_groups := jsonb_set(
        v_new_groups, 
        ARRAY[v_g_idx::text, 'subGroups', v_sg_idx::text, 'shifts', v_s_idx::text, 'employeeId'], 
        to_jsonb(v_shift_details.assigned_employee_id)
      );
      
      -- 2. Update status
      -- If assigned_employee_id is present, status is 'Assigned', else 'Open' (or 'Draft' if originally draft? Roster View logic implies 'Assigned' if employee matches)
      -- For swaps, it's definitely 'Assigned'.
      v_new_groups := jsonb_set(
        v_new_groups, 
        ARRAY[v_g_idx::text, 'subGroups', v_sg_idx::text, 'shifts', v_s_idx::text, 'status'], 
        '"Assigned"'::jsonb
      );
      
      -- 3. Update assignment object (Newer structure seen in assignEmployeeToShift)
       v_new_groups := jsonb_set(
        v_new_groups, 
        ARRAY[v_g_idx::text, 'subGroups', v_sg_idx::text, 'shifts', v_s_idx::text, 'assignment'], 
        jsonb_build_object(
            'id', 'asn-' || extract(epoch from now())::text, -- Mock ID, doesn't matter for view
            'employeeId', v_shift_details.assigned_employee_id,
            'status', 'assigned',
            'assignedAt', now()
        )
      );

      -- Update the table
      UPDATE rosters 
      SET groups = v_new_groups,
          updated_at = now()
      WHERE id = v_roster_id;
      
    END IF;
  END;

END;
$$;

-- 2. Update sm_approve_peer_swap to call sync_roster_shift_assignment
CREATE OR REPLACE FUNCTION sm_approve_peer_swap(
  p_requester_shift_id uuid,
  p_offered_shift_id uuid, -- nullable (if 1-way)
  p_requester_id uuid,
  p_offerer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requester_shift shifts%ROWTYPE;
  v_offered_shift shifts%ROWTYPE;
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

  -- 3. Execute Trade for Requester Shift (Requester -> Offerer)
  UPDATE shifts 
  SET assigned_employee_id = p_offerer_id,
      updated_at = NOW()
  WHERE id = p_requester_shift_id;
  
  -- SYNC ROSTER JSON
  PERFORM sync_roster_shift_assignment(p_requester_shift_id);

  -- 4. Execute Trade for Offered Shift (Offerer -> Requester)
  IF p_offered_shift_id IS NOT NULL THEN
    UPDATE shifts 
    SET assigned_employee_id = p_requester_id,
        updated_at = NOW()
    WHERE id = p_offered_shift_id;
    
    -- SYNC ROSTER JSON
    PERFORM sync_roster_shift_assignment(p_offered_shift_id);
  END IF;

  -- 5. Log Audit Events (Crucial for SM)
  INSERT INTO shift_audit_events (
    shift_id, event_type, old_employee_id, new_employee_id, changed_by, reason, details
  ) VALUES 
  (p_requester_shift_id, 'SWAP_COMPLETED', p_requester_id, p_offerer_id, auth.uid(), 'Swap Approved', '{"method": "sm_approve_peer_swap"}');

  IF p_offered_shift_id IS NOT NULL THEN
    INSERT INTO shift_audit_events (
      shift_id, event_type, old_employee_id, new_employee_id, changed_by, reason, details
    ) VALUES 
    (p_offered_shift_id, 'SWAP_COMPLETED', p_offerer_id, p_requester_id, auth.uid(), 'Swap Approved', '{"method": "sm_approve_peer_swap"}');
  END IF;

END;
$$;

COMMIT;
