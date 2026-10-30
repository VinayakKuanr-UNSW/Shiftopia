-- Templates follow the roster rule: the Office group holds full-time shifts
-- ONLY, and full-time shifts belong in Office only.
--
-- `enforce_no_ft_template_shifts` refused every FT template shift on the
-- premise that full-time hours came from Baseline FT. That page was retired
-- 2026-10-04 (AppRouter redirects /office to /rosters); full-time rostering is
-- now done in the Office group, from templates. The old rule left the Office
-- template group able to hold only PT / Casual, the opposite of the roster rule
-- it is applied into (`trg_shift_z_office_is_ft_only`), so every Office
-- template shift was either refused here or refused on apply.
--
-- Template groups carry no type column; the group NAME is the key, normalised
-- the way capture_roster_as_template and the apply path normalise it.
-- No Office template shifts existed when this was written, and no non-Office
-- template shift was FT, so no existing row violates the new rule.

DROP TRIGGER IF EXISTS trg_no_ft_template_shifts ON public.template_shifts;
DROP FUNCTION IF EXISTS public.enforce_no_ft_template_shifts();

CREATE OR REPLACE FUNCTION public.fn_template_shift_office_is_ft_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_office boolean;
BEGIN
    SELECT lower(replace(btrim(g.name), ' ', '_')) = 'office'
      INTO v_is_office
      FROM template_subgroups sg
      JOIN template_groups g ON g.id = sg.group_id
     WHERE sg.id = NEW.subgroup_id;

    IF coalesce(v_is_office, false)
       AND NEW.target_employment_type IS DISTINCT FROM 'FT' THEN
        RAISE EXCEPTION
            'The Office group holds full-time shifts only (target_employment_type = %).',
            COALESCE(NEW.target_employment_type, 'NULL')
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT coalesce(v_is_office, false)
       AND NEW.target_employment_type = 'FT' THEN
        RAISE EXCEPTION
            'Full-time shifts belong in the Office group only.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_template_shift_office_is_ft_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_template_shift_office_is_ft_only
    BEFORE INSERT OR UPDATE OF subgroup_id, target_employment_type
    ON public.template_shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_template_shift_office_is_ft_only();

-- "Capture roster as template" is retired (2026-10-25): templates are authored
-- in the template editor. Both overloads go; the 5-argument one was a legacy
-- version with no authorisation guard that never set target_employment_type.
DROP FUNCTION IF EXISTS public.capture_roster_as_template(date, date, uuid, text);
DROP FUNCTION IF EXISTS public.capture_roster_as_template(date, date, uuid, text, uuid);
