-- Migration 20260502000021: Finalize Broadcast Hierarchy and Fan-out

-- 1. Refine get_broadcast_group_role to support hierarchy inheritance
CREATE OR REPLACE FUNCTION public.get_broadcast_group_role(p_group_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_group_org_id uuid;
  v_group_dept_id uuid;
  v_group_sub_dept_id uuid;
  v_user_org_id uuid;
  v_user_dept_id uuid;
  v_user_sub_dept_id uuid;
BEGIN
  -- A. Check for system management permissions first
  IF EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND legacy_system_role IN ('admin', 'manager')
  ) THEN
    RETURN 'admin';
  END IF;

  -- B. Check explicit participation in the group
  SELECT role INTO v_role
  FROM group_participants
  WHERE group_id = p_group_id
    AND employee_id = auth.uid()
  LIMIT 1;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- C. Check hierarchy inheritance
  SELECT organization_id, department_id, sub_department_id 
  INTO v_group_org_id, v_group_dept_id, v_group_sub_dept_id
  FROM broadcast_groups
  WHERE id = p_group_id;

  -- Get user's active contract
  SELECT organization_id, department_id, sub_department_id
  INTO v_user_org_id, v_user_dept_id, v_user_sub_dept_id
  FROM user_contracts
  WHERE user_id = auth.uid() AND status = 'Active'
  LIMIT 1;

  -- Match logic:
  -- If sub_dept is specified, must match exactly
  -- If only dept is specified, must match dept
  -- If only org is specified, must match org
  
  IF v_group_sub_dept_id IS NOT NULL THEN
    IF v_group_sub_dept_id = v_user_sub_dept_id THEN
      RETURN 'member';
    END IF;
  ELSIF v_group_dept_id IS NOT NULL THEN
    IF v_group_dept_id = v_user_dept_id THEN
      RETURN 'member';
    END IF;
  ELSIF v_group_org_id IS NOT NULL THEN
    IF v_group_org_id = v_user_org_id THEN
      RETURN 'member';
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- 2. Create v_group_all_participants view
CREATE OR REPLACE VIEW public.v_group_all_participants AS
-- Explicit participants
SELECT 
    group_id,
    employee_id,
    role,
    true as is_explicit
FROM public.group_participants
UNION
-- Hierarchy-based members (only if not already an explicit participant)
SELECT 
    bg.id as group_id,
    uc.user_id as employee_id,
    'member'::text as role,
    false as is_explicit
FROM public.broadcast_groups bg
JOIN public.user_contracts uc ON uc.status = 'Active'
WHERE 
    NOT EXISTS (
        SELECT 1 FROM public.group_participants gp 
        WHERE gp.group_id = bg.id AND gp.employee_id = uc.user_id
    )
    AND (
        (bg.sub_department_id IS NOT NULL AND uc.sub_department_id = bg.sub_department_id)
        OR
        (bg.sub_department_id IS NULL AND bg.department_id IS NOT NULL AND uc.department_id = bg.department_id)
        OR
        (bg.sub_department_id IS NULL AND bg.department_id IS NULL AND bg.organization_id IS NOT NULL AND uc.organization_id = bg.organization_id)
    );

-- 3. Update v_unread_broadcasts_by_group to use v_group_all_participants
DROP VIEW IF EXISTS public.v_unread_broadcasts_by_group;
CREATE OR REPLACE VIEW public.v_unread_broadcasts_by_group AS
SELECT 
    gap.group_id,
    gap.employee_id,
    count(DISTINCT b.id) FILTER (WHERE brs.read_at IS NULL) AS unread_count,
    bool_or(b.priority = 'urgent'::text AND brs.read_at IS NULL) AS has_urgent_unread,
    bool_or(b.requires_acknowledgement = true AND ba.acknowledged_at IS NULL) AS has_pending_ack
FROM public.v_group_all_participants gap
JOIN public.broadcast_channels c ON c.group_id = gap.group_id
JOIN public.broadcasts b ON b.channel_id = c.id AND b.is_archived = false
LEFT JOIN public.broadcast_read_status brs ON brs.broadcast_id = b.id AND brs.employee_id = gap.employee_id
LEFT JOIN public.broadcast_acknowledgements ba ON ba.broadcast_id = b.id AND ba.employee_id = gap.employee_id
GROUP BY gap.group_id, gap.employee_id;

-- 4. Update v_broadcast_groups_with_stats for accurate participant counts
DROP VIEW IF EXISTS public.v_broadcast_groups_with_stats;
CREATE OR REPLACE VIEW public.v_broadcast_groups_with_stats AS
SELECT 
    g.id,
    g.name,
    g.description,
    g.department_id,
    g.sub_department_id,
    g.organization_id,
    g.created_by,
    g.is_active,
    g.icon,
    g.color,
    g.created_at,
    g.updated_at,
    (SELECT count(*) FROM public.broadcast_channels c WHERE c.group_id = g.id AND c.is_active = true) AS channel_count,
    (SELECT count(*) FROM public.v_group_all_participants gap WHERE gap.group_id = g.id) AS participant_count,
    COALESCE(sum(c_stats.active_broadcast_count), 0) AS active_broadcast_count,
    COALESCE(sum(c_stats.total_broadcast_count), 0) AS total_broadcast_count,
    max(c_stats.last_broadcast_at) AS last_broadcast_at
FROM public.broadcast_groups g
LEFT JOIN public.v_channels_with_stats c_stats ON c_stats.group_id = g.id
GROUP BY g.id;

-- 5. Hardening RLS on broadcast_groups and group_participants
DROP POLICY IF EXISTS broadcast_groups_select ON public.broadcast_groups;
CREATE POLICY broadcast_groups_select ON public.broadcast_groups
FOR SELECT TO authenticated
USING (get_broadcast_group_role(id) IS NOT NULL);

DROP POLICY IF EXISTS group_participants_select ON public.group_participants;
CREATE POLICY group_participants_select ON public.group_participants
FOR SELECT TO authenticated
USING (employee_id = auth.uid() OR get_broadcast_group_role(group_id) = 'admin');

-- 6. Implement Triggered Fan-out for Broadcast Notifications
CREATE OR REPLACE FUNCTION public.trg_fan_out_broadcast()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  -- Get group ID from channel
  SELECT group_id INTO v_group_id
  FROM broadcast_channels
  WHERE id = NEW.channel_id;

  -- Create notifications for all participants (explicit or hierarchy-based)
  -- This will automatically trigger trg_broadcast_to_notifications to notify the user
  INSERT INTO broadcast_notifications (broadcast_id, employee_id)
  SELECT 
    NEW.id, 
    gap.employee_id
  FROM v_group_all_participants gap
  WHERE gap.group_id = v_group_id
  ON CONFLICT (broadcast_id, employee_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fan_out_broadcast ON public.broadcasts;
CREATE TRIGGER trg_fan_out_broadcast
AFTER INSERT ON public.broadcasts
FOR EACH ROW
EXECUTE FUNCTION public.trg_fan_out_broadcast();
