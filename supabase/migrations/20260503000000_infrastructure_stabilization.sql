-- ==========================================
-- INFRASTRUCTURE STABILIZATION: Repair Shifts & Broadcasts
-- ==========================================

-- 1. ADD MISSING COLUMNS TO SHIFTS
-- These columns are required by the Timesheet and Attendance modules
ALTER TABLE public.shifts 
    ADD COLUMN IF NOT EXISTS actual_start timestamptz,
    ADD COLUMN IF NOT EXISTS actual_end timestamptz,
    ADD COLUMN IF NOT EXISTS attendance_note text,
    ADD COLUMN IF NOT EXISTS net_length_minutes numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scheduled_length_minutes numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remuneration_rate numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS compliance_override boolean DEFAULT false;

-- 2. FIX BROADCAST NOTIFICATIONS SCHEMA
-- Ensure unique constraint for idempotency during fan-out
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_notifications_broadcast_employee_idx'
    ) THEN
        ALTER TABLE public.broadcast_notifications 
        ADD CONSTRAINT broadcast_notifications_broadcast_employee_idx UNIQUE (broadcast_id, employee_id);
    END IF;
END $$;

-- Make redundant/nullable columns actually nullable to fix fan-out trigger
ALTER TABLE public.broadcast_notifications 
    ALTER COLUMN channel_id DROP NOT NULL,
    ALTER COLUMN subject DROP NOT NULL,
    ALTER COLUMN author_name DROP NOT NULL,
    ALTER COLUMN priority DROP NOT NULL;

-- 3. RE-IMPLEMENT BROADCAST FAN-OUT TRIGGER
-- This version is robust and handles hierarchy-based member inheritance
CREATE OR REPLACE FUNCTION public.trg_fan_out_broadcast()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  -- 1. Get group ID from channel
  SELECT group_id INTO v_group_id
  FROM broadcast_channels
  WHERE id = NEW.channel_id;

  -- 2. Create notifications for all participants (explicit or hierarchy-based)
  -- Uses the v_group_all_participants view created in the previous migration
  INSERT INTO broadcast_notifications (
    broadcast_id, 
    employee_id,
    channel_id,
    subject,
    author_name,
    priority
  )
  SELECT 
    NEW.id, 
    gap.employee_id,
    NEW.channel_id,
    NEW.subject,
    (SELECT COALESCE(full_name, email) FROM profiles WHERE id = NEW.author_id),
    NEW.priority
  FROM v_group_all_participants gap
  WHERE gap.group_id = v_group_id
  ON CONFLICT (broadcast_id, employee_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Ensure trigger is applied
DROP TRIGGER IF EXISTS trg_fan_out_broadcast ON public.broadcasts;
CREATE TRIGGER trg_fan_out_broadcast
AFTER INSERT ON public.broadcasts
FOR EACH ROW
EXECUTE FUNCTION public.trg_fan_out_broadcast();

-- 4. ENSURE UNREAD VIEWS ARE CORRECT
-- Re-create v_unread_broadcasts_by_group to ensure it uses the latest schema
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
