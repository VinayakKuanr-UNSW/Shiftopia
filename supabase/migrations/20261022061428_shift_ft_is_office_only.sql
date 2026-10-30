-- The reverse of 20261022055538: full-time shifts belong in the Office group only.
--
-- Together the two rules make Office and FT the same set: Office => FT and
-- FT => Office. The 8 legacy FT shifts outside Office were deleted first
-- (2026-10-22), so no existing row violates this. Same function and trigger
-- (`trg_shift_z_office_is_ft_only`, which fires after `trg_shift_placement`).
CREATE OR REPLACE FUNCTION public.fn_shift_office_is_ft_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.group_type::text = 'office'
       AND NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
        RAISE EXCEPTION
            'The Office group holds full-time shifts only (target_employment_type = %).',
            COALESCE(NEW.target_employment_type, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_employment_type = 'FT'
       AND NEW.group_type::text IS DISTINCT FROM 'office' THEN
        RAISE EXCEPTION
            'Full-time shifts belong in the Office group only (group = %).',
            COALESCE(NEW.group_type::text, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shift_office_is_ft_only() FROM PUBLIC, anon, authenticated;
