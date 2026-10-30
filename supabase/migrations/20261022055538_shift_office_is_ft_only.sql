-- The Office roster group holds full-time shifts ONLY.
--
-- The UI offered every employment type in Office (it only hid FT elsewhere),
-- so a PT/Casual shift could be created there. Office is the one fixed group
-- full-time people are rostered in (docs/modules/full-time-rostering.md); a
-- non-FT shift in it is mis-filed and escapes the FT rules.
--
-- One direction only: Office => FT. The reverse (FT => Office) is NOT enforced:
-- 8 legacy FT shifts sat in convention_centre / theatre when this was written (deleted
-- 2026-10-22; none remain).
--
-- Named `trg_shift_z_*` on purpose: BEFORE triggers fire in NAME order and
-- `trg_shift_placement` is what resolves group_type from the sub-group, so this
-- must sort after it or it would read an unresolved group_type.
CREATE OR REPLACE FUNCTION public.fn_shift_office_is_ft_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.deleted_at IS NULL
       AND NEW.group_type::text = 'office'
       AND NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
        RAISE EXCEPTION
            'The Office group holds full-time shifts only (target_employment_type = %).',
            COALESCE(NEW.target_employment_type, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shift_office_is_ft_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shift_z_office_is_ft_only ON public.shifts;
CREATE TRIGGER trg_shift_z_office_is_ft_only
    BEFORE INSERT OR UPDATE OF group_type, sub_group_name, roster_subgroup_id, target_employment_type
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_office_is_ft_only();
