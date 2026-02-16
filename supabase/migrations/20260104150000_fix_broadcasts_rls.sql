-- Fix RLS for Broadcasts Table
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they match to avoid errors
DROP POLICY IF EXISTS "Enable all access for authenticated users on broadcasts" ON broadcasts;

-- Create policy to allow authenticated users to do everything on broadcasts
-- In a real app, you might restrict this more (e.g., only group admins can insert), but for now we follow the pattern of other tables
CREATE POLICY "Enable all access for authenticated users on broadcasts" ON broadcasts
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Ensure RLS is enabled/fixed for group_participants as well just in case
ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for authenticated users on group_participants" ON group_participants;
CREATE POLICY "Enable all access for authenticated users on group_participants" ON group_participants
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
