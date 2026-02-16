/*
  # Create Missing Broadcast System Tables
  
  ## Overview
  This migration creates the missing broadcast_group_members and broadcast_notifications
  tables that work with the existing broadcast_groups and broadcasts tables.
  
  ## New Tables
  
  ### 1. broadcast_group_members
  - `id` (uuid, primary key)
  - `group_id` (uuid, foreign key to broadcast_groups)
  - `employee_id` (uuid, foreign key to employees)
  - `is_admin` (boolean, default false)
  - `joined_at` (timestamptz)
  
  ### 2. broadcast_notifications
  - `id` (uuid, primary key)
  - `broadcast_id` (uuid, foreign key to broadcasts)
  - `employee_id` (uuid, foreign key to employees)
  - `is_read` (boolean, default false)
  - `read_at` (timestamptz, nullable)
  - `created_at` (timestamptz)
  
  ## Security
  - Enable RLS on all tables
  - Authenticated users have full access (simplified for now)
  
  ## Important Notes
  - Works with existing broadcast_groups and broadcasts tables
  - Compatible with the frontend db-client.ts expectations
*/

-- Create broadcast_group_members table if it doesn't exist
CREATE TABLE IF NOT EXISTS broadcast_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES broadcast_groups(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_admin boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, employee_id)
);

-- Create broadcast_notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS broadcast_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(broadcast_id, employee_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_group_members_group_id ON broadcast_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_group_members_employee_id ON broadcast_group_members(employee_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_notifications_broadcast_id ON broadcast_notifications(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_notifications_employee_id ON broadcast_notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_notifications_is_read ON broadcast_notifications(is_read);

-- Enable Row Level Security
ALTER TABLE broadcast_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for broadcast_group_members
CREATE POLICY "Authenticated users can view group members"
  ON broadcast_group_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can add group members"
  ON broadcast_group_members FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update group members"
  ON broadcast_group_members FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can remove group members"
  ON broadcast_group_members FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies for broadcast_notifications
CREATE POLICY "Authenticated users can view notifications"
  ON broadcast_notifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update notifications"
  ON broadcast_notifications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can create notifications"
  ON broadcast_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete notifications"
  ON broadcast_notifications FOR DELETE
  TO authenticated
  USING (true);