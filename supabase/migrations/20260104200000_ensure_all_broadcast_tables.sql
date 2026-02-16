-- COMPREHENSIVE FIX: Ensure all broadcast-related tables exist with correct schema
-- This is the definitive schema that matches the API expectations

-- ============================================================
-- BROADCAST ATTACHMENTS (was missing after table recreation)
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer,
  file_url text NOT NULL,
  storage_path text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_attachments_broadcast ON broadcast_attachments(broadcast_id);

ALTER TABLE broadcast_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users on attachments" ON broadcast_attachments;
CREATE POLICY "Enable all access for authenticated users on attachments" ON broadcast_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- BROADCAST READ STATUS (ensure it exists)
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_read_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  UNIQUE(broadcast_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_read_status_broadcast ON broadcast_read_status(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_read_status_employee ON broadcast_read_status(employee_id);

ALTER TABLE broadcast_read_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users on read status" ON broadcast_read_status;
CREATE POLICY "Enable all access for authenticated users on read status" ON broadcast_read_status
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- BROADCAST ACKNOWLEDGEMENTS (ensure it exists)
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at timestamptz DEFAULT now(),
  UNIQUE(broadcast_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_acknowledgements_broadcast ON broadcast_acknowledgements(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_acknowledgements_employee ON broadcast_acknowledgements(employee_id);

ALTER TABLE broadcast_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users on acks" ON broadcast_acknowledgements;
CREATE POLICY "Enable all access for authenticated users on acks" ON broadcast_acknowledgements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- FUNCTIONS (ensure they exist)
-- ============================================================

CREATE OR REPLACE FUNCTION mark_broadcast_read(broadcast_uuid uuid, employee_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO broadcast_read_status (broadcast_id, employee_id)
  VALUES (broadcast_uuid, employee_uuid)
  ON CONFLICT (broadcast_id, employee_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_broadcast(broadcast_uuid uuid, employee_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM broadcast_acknowledgements 
    WHERE broadcast_id = broadcast_uuid AND employee_id = employee_uuid
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO broadcast_acknowledgements (broadcast_id, employee_id)
  VALUES (broadcast_uuid, employee_uuid);
  
  RETURN true;
END;
$$;
