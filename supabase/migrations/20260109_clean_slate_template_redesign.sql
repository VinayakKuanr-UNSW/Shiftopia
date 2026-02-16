-- Migration: Corrected Clean Slate for Template-Roster-Shift Redesign (Take 3)
-- Date: 2026-01-09
-- Purpose: 
--   1. Drop audit triggers temporarily to allow clean delete
--   2. Delete all existing shift/roster data in correct order
--   3. Add unique constraint on roster_templates
--   4. Create triggers for auto-seeding fixed groups
--   5. Re-enable audit triggers

-- ============================================================
-- PHASE 0: DROP AUDIT TRIGGERS TEMPORARILY
-- ============================================================
DROP TRIGGER IF EXISTS shift_audit_trigger ON shifts;
DROP TRIGGER IF EXISTS shifts_audit_trigger ON shifts;
DROP TRIGGER IF EXISTS bid_audit_trigger ON shift_bids;

-- ============================================================
-- PHASE 1: CLEAN SLATE - Delete all existing data
-- ============================================================

-- Delete in order of dependencies (children first)
DELETE FROM shift_audit_events WHERE true;
DELETE FROM roster_audit_log WHERE true;
DELETE FROM roster_shift_assignments WHERE true;
DELETE FROM roster_template_applications WHERE true;
DELETE FROM template_audit_log WHERE true;
DELETE FROM template_snapshots WHERE true;

DELETE FROM shift_bids WHERE true;
DELETE FROM shifts WHERE true;
DELETE FROM roster_shifts WHERE true;
DELETE FROM template_shifts WHERE true;

DELETE FROM roster_subgroups WHERE true;
DELETE FROM template_subgroups WHERE true;
DELETE FROM roster_groups WHERE true;
DELETE FROM template_groups WHERE true;

DELETE FROM roster_days WHERE true;
DELETE FROM rosters WHERE true;
DELETE FROM roster_templates WHERE true;

-- ============================================================
-- PHASE 2: ADD UNIQUE CONSTRAINT
-- ============================================================

ALTER TABLE roster_templates 
DROP CONSTRAINT IF EXISTS roster_templates_unique_per_scope_month;

ALTER TABLE roster_templates 
ADD CONSTRAINT roster_templates_unique_per_scope_month 
UNIQUE (organization_id, department_id, sub_department_id, published_month);

-- ============================================================
-- PHASE 3: FIXED GROUPS AUTO-SEEDING FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION seed_fixed_template_groups()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO template_groups (template_id, name, color, icon, sort_order)
    VALUES 
        (NEW.id, 'Convention Centre', '#3b82f6', 'building', 1),
        (NEW.id, 'Exhibition Centre', '#10b981', 'layout-grid', 2),
        (NEW.id, 'Theatre', '#8b5cf6', 'theater', 3);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_seed_fixed_template_groups ON roster_templates;

CREATE TRIGGER trigger_seed_fixed_template_groups
    AFTER INSERT ON roster_templates
    FOR EACH ROW
    EXECUTE FUNCTION seed_fixed_template_groups();

-- ============================================================
-- PHASE 4: FIXED ROSTER GROUPS AUTO-SEEDING
-- ============================================================

CREATE OR REPLACE FUNCTION seed_fixed_roster_groups()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO roster_groups (roster_day_id, name, color, icon, sort_order)
    VALUES 
        (NEW.id, 'Convention Centre', '#3b82f6', 'building', 1),
        (NEW.id, 'Exhibition Centre', '#10b981', 'layout-grid', 2),
        (NEW.id, 'Theatre', '#8b5cf6', 'theater', 3);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_seed_fixed_roster_groups ON roster_days;

CREATE TRIGGER trigger_seed_fixed_roster_groups
    AFTER INSERT ON roster_days
    FOR EACH ROW
    EXECUTE FUNCTION seed_fixed_roster_groups();

-- ============================================================
-- PHASE 5: RE-ENABLE AUDIT TRIGGERS
-- ============================================================

-- Re-attach the shift audit trigger
CREATE TRIGGER shift_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION log_shift_changes();

-- Re-attach bid audit trigger if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shift_bids') THEN
    CREATE TRIGGER bid_audit_trigger
      AFTER INSERT OR UPDATE OR DELETE ON shift_bids
      FOR EACH ROW EXECUTE FUNCTION log_bid_changes();
  END IF;
END;
$$;
