/*
  # FORCE Template Fix and Cleanup
  # Generated: 2026-01-05
  
  This migration is AUTHORITATIVE. It:
  1. Deletes ALL shifts (ensuring clean slate).
  2. Deleted ALL templates.
  3. Re-creates Base Templates using strict + dynamic logic.
     - Matches known sub-departments (ILIKE)
     - Generates DYNAMIC specific groups for everything else (e.g. "[SubDept] AM")
*/

-- Ensure schema exists
CREATE TABLE IF NOT EXISTS roster_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sub_department_id uuid REFERENCES sub_departments(id),
  department_id uuid REFERENCES departments(id),
  organization_id uuid REFERENCES organizations(id),
  is_base_template boolean DEFAULT false,
  status text CHECK (status IN ('draft', 'published', 'archived')),
  version integer DEFAULT 1,
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES roster_templates(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_subgroups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES template_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES roster_templates(id) ON DELETE CASCADE,
  group_id uuid REFERENCES template_groups(id) ON DELETE CASCADE,
  subgroup_id uuid REFERENCES template_subgroups(id) ON DELETE SET NULL,
  role_id uuid REFERENCES roles(id),
  day_of_week integer,
  start_time time,
  end_time time,
  created_at timestamptz DEFAULT now()
);

-- Ensure columns exist (idempotent checks in case table already existed partially)
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS is_base_template boolean DEFAULT false;
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS sub_department_id uuid REFERENCES sub_departments(id);
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS end_date date;


-- 1. DELETE ALL DATA (Clean Slate)
DELETE FROM shifts;
DELETE FROM template_shifts;
DELETE FROM template_subgroups;
DELETE FROM template_groups;
DELETE FROM roster_templates WHERE is_base_template = true;

-- 2. Create base templates
DO $$
DECLARE
  v_subdept RECORD;
  v_template_id uuid;
  v_conv_group_id uuid;
  v_exh_group_id uuid;
  v_theatre_group_id uuid;
  v_subdept_name text;
BEGIN
  -- Loop through all sub-departments and get their organization_id via department
  FOR v_subdept IN 
    SELECT sd.id, sd.name, sd.department_id, d.organization_id 
    FROM sub_departments sd
    JOIN departments d ON sd.department_id = d.id
  LOOP
    v_subdept_name := trim(v_subdept.name);
    
    -- Create the base template for this sub-department
    INSERT INTO roster_templates (
      name, 
      sub_department_id, 
      department_id,
      organization_id,
      is_base_template, 
      status,
      version,
      start_date,
      end_date,
      created_at,
      updated_at
    ) VALUES (
      v_subdept_name || ' - Base Template',
      v_subdept.id,
      v_subdept.department_id,
      v_subdept.organization_id,
      true,
      'draft',
      1,
      '2025-01-01',
      '2035-12-31',
      now(),
      now()
    ) RETURNING id INTO v_template_id;
    
    -- Create 3 fixed groups for this template
    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, 'Convention Centre', '#3B82F6', 1)
    RETURNING id INTO v_conv_group_id;
    
    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, 'Exhibition Centre', '#10B981', 2)
    RETURNING id INTO v_exh_group_id;
    
    INSERT INTO template_groups (template_id, name, color, sort_order)
    VALUES (v_template_id, 'Theatre', '#8B5CF6', 3)
    RETURNING id INTO v_theatre_group_id;
    
    -- Create sub-groups based on sub-department type (Case Insensitive)
    IF v_subdept_name ILIKE '%Event Setups%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'AM Base', 1), (v_conv_group_id, 'AM Assist', 2),
          (v_conv_group_id, 'PM Base', 3), (v_conv_group_id, 'PM Assist', 4),
          (v_conv_group_id, 'Late', 5), (v_conv_group_id, 'DHT-Set', 6), (v_conv_group_id, 'DHT-Packdown', 7),
          (v_exh_group_id, 'Bump-In', 1), (v_exh_group_id, 'Bump-Out', 2),
          (v_theatre_group_id, 'AM Set', 1), (v_theatre_group_id, 'AM Set Assist', 2),
          (v_theatre_group_id, 'PM Packdown', 3), (v_theatre_group_id, 'PM Packdown Assist', 4);
          
    ELSIF v_subdept_name ILIKE '%Logistics%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Warehouse AM', 1), (v_conv_group_id, 'Warehouse PM', 2), (v_conv_group_id, 'Dispatch', 3),
          (v_exh_group_id, 'Staging', 1), (v_exh_group_id, 'Transport', 2),
          (v_theatre_group_id, 'Load-In', 1), (v_theatre_group_id, 'Load-Out', 2);
          
    ELSIF v_subdept_name ILIKE '%Operations%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Control Room', 1), (v_conv_group_id, 'Floor Ops', 2), (v_conv_group_id, 'Admin', 3),
          (v_exh_group_id, 'Setup Crew', 1), (v_exh_group_id, 'Pack Crew', 2),
          (v_theatre_group_id, 'Stage Crew', 1), (v_theatre_group_id, 'House Crew', 2);
          
    ELSIF v_subdept_name ILIKE '%Floor Management%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Front of House', 1), (v_conv_group_id, 'VIP Area', 2), (v_conv_group_id, 'Concourse', 3),
          (v_exh_group_id, 'Expo Floor', 1), (v_exh_group_id, 'Aisle Mgmt', 2),
          (v_theatre_group_id, 'Stalls', 1), (v_theatre_group_id, 'Dress Circle', 2), (v_theatre_group_id, 'Gallery', 3);
          
    ELSIF v_subdept_name ILIKE '%Guest Services%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Registration', 1), (v_conv_group_id, 'Info Desk', 2), (v_conv_group_id, 'Concierge', 3),
          (v_exh_group_id, 'Exhibitor Liaison', 1), (v_exh_group_id, 'Visitor Services', 2),
          (v_theatre_group_id, 'Box Office', 1), (v_theatre_group_id, 'Ushers', 2);
          
    ELSIF v_subdept_name ILIKE '%Registration%' AND v_subdept_name ILIKE '%Access%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Check-In', 1), (v_conv_group_id, 'Badge Print', 2), (v_conv_group_id, 'Access Control', 3),
          (v_exh_group_id, 'Entry Gates', 1), (v_exh_group_id, 'Scanners', 2),
          (v_theatre_group_id, 'Ticket Check', 1), (v_theatre_group_id, 'Door Staff', 2);
          
    ELSIF v_subdept_name ILIKE '%VIP Services%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'VIP Lounge', 1), (v_conv_group_id, 'Executive Host', 2),
          (v_exh_group_id, 'Premium Area', 1), (v_exh_group_id, 'VIP Liaison', 2),
          (v_theatre_group_id, 'Green Room', 1), (v_theatre_group_id, 'Artist Liaison', 2);
          
    ELSIF v_subdept_name ILIKE '%Exhibitor Services%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Stand Support', 1), (v_conv_group_id, 'Tech Services', 2),
          (v_exh_group_id, 'Build Support', 1), (v_exh_group_id, 'Exhibitor Help', 2),
          (v_theatre_group_id, 'Vendor Support', 1), (v_theatre_group_id, 'Merch Area', 2);
          
    ELSIF v_subdept_name ILIKE '%Bump-In%' OR v_subdept_name ILIKE '%Bump-Out%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Early Bump-In', 1), (v_conv_group_id, 'Day Bump-In', 2), (v_conv_group_id, 'Late Packdown', 3),
          (v_exh_group_id, 'Hall Setup', 1), (v_exh_group_id, 'Hall Strip', 2),
          (v_theatre_group_id, 'Stage Bump-In', 1), (v_theatre_group_id, 'Stage Bump-Out', 2);
          
    ELSIF v_subdept_name ILIKE '%Security%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Entry Points', 1), (v_conv_group_id, 'Patrols', 2), (v_conv_group_id, 'Control Room', 3),
          (v_exh_group_id, 'Perimeter', 1), (v_exh_group_id, 'Hall Security', 2),
          (v_theatre_group_id, 'Stage Door', 1), (v_theatre_group_id, 'FOH Security', 2);
          
    ELSIF v_subdept_name ILIKE '%Parking%' OR v_subdept_name ILIKE '%Transport%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Car Park', 1), (v_conv_group_id, 'Shuttle', 2), (v_conv_group_id, 'Valet', 3),
          (v_exh_group_id, 'Truck Dock', 1), (v_exh_group_id, 'Vehicle Mgmt', 2),
          (v_theatre_group_id, 'Drop-Off', 1), (v_theatre_group_id, 'Taxi Rank', 2);
          
    ELSIF v_subdept_name ILIKE '%Event Coordination%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Event Manager', 1), (v_conv_group_id, 'Client Liaison', 2),
          (v_exh_group_id, 'Show Manager', 1), (v_exh_group_id, 'Organiser Liaison', 2),
          (v_theatre_group_id, 'Production Coord', 1), (v_theatre_group_id, 'Artist Coord', 2);

    ELSIF v_subdept_name ILIKE '%Live Production%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Stage Manager', 1), (v_conv_group_id, 'Crew Chief', 2),
          (v_exh_group_id, 'Rigging', 1), (v_exh_group_id, 'Setup', 2),
          (v_theatre_group_id, 'Tech Booth', 1), (v_theatre_group_id, 'Backstage', 2);
          
    ELSIF v_subdept_name ILIKE '%Sound Engineering%' OR v_subdept_name ILIKE '%Audio%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'FOH Audio', 1), (v_conv_group_id, 'Monitor', 2), (v_conv_group_id, 'Comms', 3),
          (v_exh_group_id, 'PA Systems', 1), (v_exh_group_id, 'Announcements', 2),
          (v_theatre_group_id, 'Orchestra', 1), (v_theatre_group_id, 'Stage Monitors', 2);
          
    ELSIF v_subdept_name ILIKE '%Lighting%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'FOH Lighting', 1), (v_conv_group_id, 'Spot Ops', 2),
          (v_exh_group_id, 'Booth Lighting', 1), (v_exh_group_id, 'Signage', 2),
          (v_theatre_group_id, 'Follow Spot', 1), (v_theatre_group_id, 'Stage Lighting', 2);
          
    ELSIF v_subdept_name ILIKE '%Vision%' OR v_subdept_name ILIKE '%Screens%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'LED Walls', 1), (v_conv_group_id, 'Projection', 2),
          (v_exh_group_id, 'Digital Signage', 1), (v_exh_group_id, 'Info Screens', 2),
          (v_theatre_group_id, 'Stage Screens', 1), (v_theatre_group_id, 'IMAG', 2);
          
    ELSIF v_subdept_name ILIKE '%Rigging%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Motor Ops', 1), (v_conv_group_id, 'Truss Crew', 2),
          (v_exh_group_id, 'Hall Rigging', 1), (v_exh_group_id, 'Banner Crew', 2),
          (v_theatre_group_id, 'Fly Crew', 1), (v_theatre_group_id, 'Grid Work', 2);
          
    ELSIF v_subdept_name ILIKE '%Staging%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Stage Build', 1), (v_conv_group_id, 'Deck Crew', 2),
          (v_exh_group_id, 'Platform Build', 1), (v_exh_group_id, 'Furniture', 2),
          (v_theatre_group_id, 'Set Build', 1), (v_theatre_group_id, 'Props', 2);
          
    ELSIF v_subdept_name ILIKE '%Broadcast%' OR v_subdept_name ILIKE '%Streaming%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Camera Ops', 1), (v_conv_group_id, 'Vision Switch', 2),
          (v_exh_group_id, 'Webcast', 1), (v_exh_group_id, 'Recording', 2),
          (v_theatre_group_id, 'Live Stream', 1), (v_theatre_group_id, 'Broadcast', 2);
          
    ELSIF v_subdept_name ILIKE '%Technical Direction%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Tech Director', 1), (v_conv_group_id, 'Crew Lead', 2),
          (v_exh_group_id, 'System Tech', 1), (v_exh_group_id, 'Support', 2),
          (v_theatre_group_id, 'Show Caller', 1), (v_theatre_group_id, 'Tech Assist', 2);
          
    ELSIF v_subdept_name ILIKE '%Equipment Stores%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Warehouse', 1), (v_conv_group_id, 'Prep', 2),
          (v_exh_group_id, 'Stores', 1), (v_exh_group_id, 'Dispatch', 2),
          (v_theatre_group_id, 'Kit Room', 1), (v_theatre_group_id, 'Returns', 2);
          
    ELSIF v_subdept_name ILIKE '%Maintenace%' OR v_subdept_name ILIKE '%AV Maintenance%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Tech Support', 1), (v_conv_group_id, 'Repairs', 2),
          (v_exh_group_id, 'On-Site Tech', 1), (v_exh_group_id, 'Troubleshoot', 2),
          (v_theatre_group_id, 'Systems Check', 1), (v_theatre_group_id, 'Preventive', 2);
          
    ELSIF v_subdept_name ILIKE '%Digital Signage%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Content Mgmt', 1), (v_conv_group_id, 'Display Tech', 2),
          (v_exh_group_id, 'Wayfinding', 1), (v_exh_group_id, 'Info Boards', 2),
          (v_theatre_group_id, 'Lobby Screens', 1), (v_theatre_group_id, 'Show Info', 2);

    ELSIF v_subdept_name ILIKE '%Cleaning%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'Day Clean', 1), (v_conv_group_id, 'Event Clean', 2), (v_conv_group_id, 'Deep Clean', 3),
          (v_exh_group_id, 'Hall Clean', 1), (v_exh_group_id, 'Aisle Clean', 2),
          (v_theatre_group_id, 'Auditorium', 1), (v_theatre_group_id, 'Foyer Clean', 2);
          
    ELSIF v_subdept_name ILIKE '%Building%' THEN
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, 'General Maint', 1), (v_conv_group_id, 'Repairs', 2),
          (v_exh_group_id, 'Hall Maint', 1), (v_exh_group_id, 'Fixtures', 2),
          (v_theatre_group_id, 'Stage Maint', 1), (v_theatre_group_id, 'Seating', 2);
          
    ELSE
        -- Fallback: Create specific groups using the sub-department name
        -- This ensures every template has unique, specific sub-groups even if not matched above
        RAISE NOTICE 'Using dynamic specific groups for: %', v_subdept_name;
        
        INSERT INTO template_subgroups (group_id, name, sort_order) VALUES
          (v_conv_group_id, v_subdept_name || ' AM', 1), 
          (v_conv_group_id, v_subdept_name || ' PM', 2),
          (v_conv_group_id, v_subdept_name || ' Generic', 3),
          
          (v_exh_group_id, v_subdept_name || ' Day', 1), 
          (v_exh_group_id, v_subdept_name || ' Event', 2),
          
          (v_theatre_group_id, v_subdept_name || ' Show', 1), 
          (v_theatre_group_id, v_subdept_name || ' Prep', 2);
    END IF;
    
  END LOOP;
  
  RAISE NOTICE 'Created base templates for all sub-departments';
END $$;
