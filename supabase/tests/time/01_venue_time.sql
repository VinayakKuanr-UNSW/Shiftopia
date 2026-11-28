-- LOCAL TEST DB ONLY. Run after access_matrix/01_fixtures.sql; everything rolls back.
-- Venue time (migration *_venue_timezones): a shift's zone is its organization's,
-- its instants are that venue's wall clock, and "today" is the venue's date.
-- Shift 4 belongs to the fixture "Other Org" (Australia/Perth). One line per case.
\set QUIET on
BEGIN;
DO $t$
DECLARE
    other constant uuid := '00000000-0000-0000-0000-0000000000f2';
    icc   constant uuid := '00000000-0000-0000-0000-000000000001';
    s4    constant uuid := 'b1000000-0000-4000-8000-000000000004';
    zone  text;
    same  boolean;
BEGIN
    UPDATE public.shifts SET timezone = 'UTC' WHERE id = s4 RETURNING timezone INTO zone;
    RAISE NOTICE 'a shift takes its organization''s zone, whatever is sent: %', zone;

    SELECT to_char(start_at AT TIME ZONE 'Australia/Perth', 'HH24:MI') = to_char(start_time, 'HH24:MI')
      INTO same FROM public.shifts WHERE id = s4;
    RAISE NOTICE 'its start_at is the Perth wall clock: %', same;

    RAISE NOTICE 'today is the venue''s date: %',
        public.organization_today(icc)   = (now() AT TIME ZONE 'Australia/Sydney')::date
    AND public.organization_today(other) = (now() AT TIME ZONE 'Australia/Perth')::date;

    BEGIN
        UPDATE public.organizations SET timezone = 'Mars/Olympus_Mons' WHERE id = other;
        RAISE NOTICE 'unknown zone: accepted';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'unknown zone: refused (%)', SQLSTATE;
    END;

    BEGIN
        PERFORM public.organization_timezone('00000000-0000-0000-0000-00000000dead');
        RAISE NOTICE 'organization without a zone: answered';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'organization without a zone: refused (%)', SQLSTATE;
    END;
END
$t$;
ROLLBACK;
