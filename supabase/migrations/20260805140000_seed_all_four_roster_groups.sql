-- Migration: 20260805140000_seed_all_four_roster_groups.sql
-- Description: `seed_standard_roster_groups` seeds all FOUR venue groups, not three,
--              and existing rosters missing one get it backfilled.
--
-- THE BUG
-- -------
-- The AFTER INSERT trigger on `rosters` has always seeded three groups:
--
--     ('Convention Centre', 'convention_centre', 0),
--     ('Exhibition Centre', 'exhibition_centre', 1),
--     ('Theatre',           'theatre',           2)
--     -- The Cutaway missing
--
-- with a comment calling them "the three standard groups". The Cutaway is a real,
-- in-production venue group and the fourth of the four fixed groups the roster grid
-- renders unconditionally -- it was simply never added to the trigger when the
-- venue was.
--
-- Prod shows the fingerprint exactly (verified 2026-08-05):
--     convention_centre 163 | exhibition_centre 163 | theatre 163 | the_cutaway 160
-- The 160 are the rosters that happened to be touched by
-- apply_template_to_date_range_v2, which builds groups from the TEMPLATE's groups
-- and so creates The Cutaway when the template has it. The other 3 never were.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
-- ---------------------------------
-- `shifts.roster_subgroup_id` is NOT NULL, and a subgroup can only be found or
-- created underneath a GROUP. So on a roster with no `the_cutaway` group row,
-- creating a Cutaway shift does not degrade -- it fails outright with a 23502.
-- The grid happily offers the Cutaway row (it renders all four group types from a
-- frontend constant, not from the database), so the failure looks arbitrary to the
-- user: the same action works on one day and errors on another.
--
-- RELATIONSHIP TO sm_resolve_roster
-- ---------------------------------
-- 20260805100000 already backfills the four groups whenever it resolves a roster.
-- That is a repair, and it stays -- it is what makes legacy rosters safe. This
-- migration fixes the source, so newly created rosters are correct on arrival
-- regardless of which path created them. Both are idempotent against
-- roster_groups_roster_id_external_id_key.

-- ── 1. Fix the source ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_standard_roster_groups()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Auto-seed the four standard venue groups for every new roster row.
    -- These are constant for ICC Sydney as per requirements, and match
    -- ALL_GROUP_TYPES / GROUP_DISPLAY_NAMES in
    -- src/modules/rosters/domain/projections/constants.ts.
    INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
    VALUES
        (NEW.id, 'Convention Centre', 'convention_centre', 0),
        (NEW.id, 'Exhibition Centre', 'exhibition_centre', 1),
        (NEW.id, 'Theatre',           'theatre',           2),
        (NEW.id, 'The Cutaway',       'the_cutaway',       3)
    ON CONFLICT (roster_id, external_id) DO NOTHING;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.seed_standard_roster_groups() OWNER TO postgres;

-- ── 2. Backfill every roster missing any of the four ─────────────────────────
-- Idempotent: the NOT EXISTS plus the unique key make a replay a no-op. Matches on
-- external_id OR name so a roster that has the group under a differing label is
-- not given a duplicate.
INSERT INTO public.roster_groups (roster_id, name, external_id, sort_order)
SELECT r.id, g.name, g.external_id, g.sort_order
  FROM public.rosters r
 CROSS JOIN (VALUES
        ('Convention Centre', 'convention_centre', 0),
        ('Exhibition Centre', 'exhibition_centre', 1),
        ('Theatre',           'theatre',           2),
        ('The Cutaway',       'the_cutaway',       3)
     ) AS g(name, external_id, sort_order)
 WHERE NOT EXISTS (
     SELECT 1 FROM public.roster_groups rg
      WHERE rg.roster_id = r.id
        AND (rg.external_id = g.external_id OR rg.name = g.name)
 )
ON CONFLICT (roster_id, external_id) DO NOTHING;

COMMENT ON FUNCTION public.seed_standard_roster_groups() IS
    'Seeds the four fixed venue groups (Convention Centre, Exhibition Centre, '
    'Theatre, The Cutaway) on every new roster. Seeded only three until '
    '20260805140000, which left The Cutaway absent on any roster not created via '
    'a template -- and because shifts.roster_subgroup_id is NOT NULL, that made '
    'Cutaway shifts fail with a 23502 on those days.';
