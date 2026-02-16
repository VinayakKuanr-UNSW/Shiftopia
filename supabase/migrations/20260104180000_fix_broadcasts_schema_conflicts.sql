-- Drop and recreate broadcasts table with correct modern schema
-- This resolves conflicts between old broadcast schema and new channel-based schema

DROP TABLE IF EXISTS broadcast_reads CASCADE;
DROP TABLE IF EXISTS broadcasts CASCADE;

-- Recreate broadcasts table with modern schema matching the API
CREATE TABLE broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES broadcast_channels(id) ON DELETE CASCADE,
  author_id uuid, -- Nullable, references employees but constraint removed
  created_by uuid, -- Nullable, for audit trail
  subject text,
  title text, -- Required by some workflows
  content text NOT NULL,
  priority text DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  is_pinned boolean DEFAULT false,
  is_archived boolean DEFAULT false,
  archived_by uuid,
  requires_acknowledgement boolean DEFAULT false,
  organization_id uuid, -- Nullable
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_broadcasts_channel ON broadcasts(channel_id);
CREATE INDEX idx_broadcasts_created_at ON broadcasts(created_at DESC);
CREATE INDEX idx_broadcasts_archived ON broadcasts(is_archived);

-- Enable RLS
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- Create permissive RLS policy
DROP POLICY IF EXISTS "Enable all access for authenticated users on broadcasts" ON broadcasts;
CREATE POLICY "Enable all access for authenticated users on broadcasts" ON broadcasts
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Similarly fix group_participants to NOT use user_id but employee_id
DROP TABLE IF EXISTS group_members CASCADE;

-- Ensure group_participants exists with correct schema
CREATE TABLE IF NOT EXISTS group_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES broadcast_groups(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'broadcaster', 'member')),
  organization_id uuid, -- Nullable
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_group_participants_group ON group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_employee ON group_participants(employee_id);

ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users on participants" ON group_participants;
CREATE POLICY "Enable all access for authenticated users on participants" ON group_participants
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
