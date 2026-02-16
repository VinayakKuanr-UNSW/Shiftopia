-- Fix RLS for Broadcast Groups
ALTER TABLE broadcast_groups ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they match to avoid errors, or just use create if not exists style
DROP POLICY IF EXISTS "Enable all access for authenticated users on groups" ON broadcast_groups;
CREATE POLICY "Enable all access for authenticated users on groups" ON broadcast_groups FOR ALL TO authenticated USING (true);

-- Create Notifications Table if it doesn't exist
CREATE TABLE IF NOT EXISTS broadcast_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type text NOT NULL, -- 'new_broadcast', 'reminder', etc
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb -- For linking back to broadcast_id, group_id
);

-- Enable RLS
ALTER TABLE broadcast_notifications ENABLE ROW LEVEL SECURITY;

-- Policies for notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON broadcast_notifications;
CREATE POLICY "Users can view their own notifications" ON broadcast_notifications 
  FOR SELECT TO authenticated 
  USING (employee_id = auth.uid() OR employee_id IN (SELECT id FROM employees WHERE id = auth.uid())); -- Handle auth mapping

DROP POLICY IF EXISTS "Users can update their own notifications" ON broadcast_notifications;
CREATE POLICY "Users can update their own notifications" ON broadcast_notifications 
  FOR UPDATE TO authenticated 
  USING (employee_id = auth.uid() OR employee_id IN (SELECT id FROM employees WHERE id = auth.uid()));

-- Allow system/functions to insert notifications (broadly for now)
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON broadcast_notifications;
CREATE POLICY "Enable insert for authenticated users" ON broadcast_notifications FOR INSERT TO authenticated WITH CHECK (true);
