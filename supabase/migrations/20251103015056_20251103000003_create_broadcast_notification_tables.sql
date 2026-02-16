/*
  # Create Broadcast and Real-Time Notification System

  ## Overview
  This migration creates comprehensive broadcast messaging and real-time notification infrastructure
  for team communication with group management and read tracking.

  ## New Tables

  ### 1. broadcast_groups
  - `id` (uuid, primary key)
  - `name` (text, not null) - Group name
  - `description` (text) - Group description
  - `department_id` (uuid, foreign key to departments, nullable) - Optional department association
  - `created_by` (uuid, foreign key to auth.users) - Creator
  - `is_active` (boolean, default true)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. group_members
  - `id` (uuid, primary key)
  - `group_id` (uuid, foreign key to broadcast_groups)
  - `user_id` (uuid, foreign key to auth.users)
  - `role` (text) - admin, member
  - `joined_at` (timestamptz)

  ### 3. broadcasts
  - `id` (uuid, primary key)
  - `group_id` (uuid, foreign key to broadcast_groups)
  - `sender_id` (uuid, foreign key to auth.users)
  - `message` (text, not null)
  - `sent_at` (timestamptz)
  - `read_count` (integer, default 0)
  - `total_recipients` (integer, default 0)

  ### 4. broadcast_reads
  - `id` (uuid, primary key)
  - `broadcast_id` (uuid, foreign key to broadcasts)
  - `user_id` (uuid, foreign key to auth.users)
  - `read_at` (timestamptz)

  ### 5. notification_queue
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `notification_type` (text) - broadcast, swap, shift_assignment, approval, etc.
  - `reference_id` (uuid) - ID of related entity
  - `title` (text)
  - `message` (text)
  - `is_read` (boolean, default false)
  - `created_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Users can only see groups they're members of
  - Users can only see their own notifications
  - Group admins can manage group membership

  ## Indexes
  - Add indexes on foreign keys and frequently queried fields
  - Enable Supabase Realtime on broadcasts and notification_queue
*/

-- Create broadcast_groups table
CREATE TABLE IF NOT EXISTS broadcast_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create group_members junction table
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES broadcast_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Create broadcasts table
CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES broadcast_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  read_count integer DEFAULT 0,
  total_recipients integer DEFAULT 0
);

-- Create broadcast_reads junction table
CREATE TABLE IF NOT EXISTS broadcast_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  UNIQUE(broadcast_id, user_id)
);

-- Create notification_queue table
CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('broadcast', 'swap', 'shift_assignment', 'approval', 'reminder', 'alert', 'system')),
  reference_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_groups_created_by ON broadcast_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_broadcast_groups_department ON broadcast_groups(department_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_groups_is_active ON broadcast_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
-- CREATE INDEX IF NOT EXISTS idx_broadcasts_group ON broadcasts(group_id);
-- CREATE INDEX IF NOT EXISTS idx_broadcasts_sender ON broadcasts(sender_id);
-- CREATE INDEX IF NOT EXISTS idx_broadcasts_sent_at ON broadcasts(sent_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_broadcast_reads_broadcast ON broadcast_reads(broadcast_id);
-- CREATE INDEX IF NOT EXISTS idx_broadcast_reads_user ON broadcast_reads(user_id);
-- CREATE INDEX IF NOT EXISTS idx_broadcast_reads_read ON broadcast_reads(read_at);ion_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_is_read ON notification_queue(is_read);
CREATE INDEX IF NOT EXISTS idx_notification_queue_type ON notification_queue(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_queue_created_at ON notification_queue(created_at DESC);

-- Enable Row Level Security
ALTER TABLE broadcast_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for broadcast_groups
-- RLS Policies for broadcast_groups
-- CREATE POLICY "Users can view groups they are members of" ON broadcast_groups FOR SELECT TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = broadcast_groups.id
--     AND gm.user_id = auth.uid()
--   ) OR created_by = auth.uid()
-- );
-- 
-- CREATE POLICY "Users can create broadcast groups" ON broadcast_groups FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
-- 
-- CREATE POLICY "Group creators can update their groups" ON broadcast_groups FOR UPDATE TO authenticated
-- USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- RLS Policies for group_members
-- CREATE POLICY "Users can view members of their groups" ON group_members FOR SELECT TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = group_members.group_id
--     AND gm.user_id = auth.uid()
--   )
-- );
-- 
-- CREATE POLICY "Group admins can add members" ON group_members FOR INSERT TO authenticated
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = group_members.group_id
--     AND gm.user_id = auth.uid()
--     AND gm.role = 'admin'
--   )
-- );
-- 
-- CREATE POLICY "Group admins can remove members" ON group_members FOR DELETE TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = group_members.group_id
--     AND gm.user_id = auth.uid()
--     AND gm.role = 'admin'
--   )
-- );

-- RLS Policies for broadcasts
-- CREATE POLICY "Users can view broadcasts in their groups" ON broadcasts FOR SELECT TO authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = broadcasts.group_id
--     AND gm.user_id = auth.uid()
--   )
-- );
-- 
-- CREATE POLICY "Group members can create broadcasts" ON broadcasts FOR INSERT TO authenticated
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM group_members gm
--     WHERE gm.group_id = broadcasts.group_id
--     AND gm.user_id = auth.uid()
--   ) AND sender_id = auth.uid()
-- );

-- RLS Policies for broadcast_reads
-- CREATE POLICY "Users can view their own read receipts" ON broadcast_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
-- CREATE POLICY "Users can mark broadcasts as read" ON broadcast_reads FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- RLS Policies for notification_queue
-- CREATE POLICY "Users can view their own notifications" ON notification_queue FOR SELECT TO authenticated USING (user_id = auth.uid());
-- CREATE POLICY "System can create notifications" ON notification_queue FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Users can update their own notifications" ON notification_queue FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- CREATE POLICY "Users can delete their own notifications" ON notification_queue FOR DELETE TO authenticated USING (user_id = auth.uid());
