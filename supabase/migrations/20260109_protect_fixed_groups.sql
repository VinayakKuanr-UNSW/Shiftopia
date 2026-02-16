-- Migration: Protect Fixed Template & Roster Groups
-- Date: 2026-01-09
-- Purpose: Prevent renaming of the 3 fixed groups (Convention Centre, Exhibition Centre, Theatre)
--          Delete is ALLOWED (to support cascading deletes).

-- ============================================================
-- 1. PROTECT TEMPLATE GROUPS
-- ============================================================

CREATE OR REPLACE FUNCTION protect_fixed_template_groups()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.name IN ('Convention Centre', 'Exhibition Centre', 'Theatre') THEN
        IF TG_OP = 'UPDATE' AND NEW.name != OLD.name THEN
            RAISE EXCEPTION 'Renaming of fixed group "%" is not allowed.', OLD.name;
        END IF;
        -- Allow DELETE (cascade)
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_fixed_template_groups ON template_groups;

CREATE TRIGGER trigger_protect_fixed_template_groups
    BEFORE DELETE OR UPDATE OF name ON template_groups
    FOR EACH ROW
    EXECUTE FUNCTION protect_fixed_template_groups();

-- ============================================================
-- 2. PROTECT ROSTER GROUPS
-- ============================================================

CREATE OR REPLACE FUNCTION protect_fixed_roster_groups()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.name IN ('Convention Centre', 'Exhibition Centre', 'Theatre') THEN
        IF TG_OP = 'UPDATE' AND NEW.name != OLD.name THEN
            RAISE EXCEPTION 'Renaming of fixed group "%" is not allowed.', OLD.name;
        END IF;
        -- Allow DELETE (cascade)
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_fixed_roster_groups ON roster_groups;

CREATE TRIGGER trigger_protect_fixed_roster_groups
    BEFORE DELETE OR UPDATE OF name ON roster_groups
    FOR EACH ROW
    EXECUTE FUNCTION protect_fixed_roster_groups();
