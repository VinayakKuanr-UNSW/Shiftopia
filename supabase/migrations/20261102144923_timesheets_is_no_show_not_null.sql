-- ============================================================================
-- Migration: Ensure public.timesheets.is_no_show is strictly boolean NOT NULL
-- ============================================================================
-- Under SQL three-valued logic, `(arrival_track = 'missing' AND departure_track = 'missing')`
-- evaluates to NULL when `arrival_track = 'missing'` and `departure_track IS NULL`
-- (e.g., an in-progress shift past scheduled start before scheduled end).
-- Wrapping with COALESCE(..., false) + NOT NULL guarantees `is_no_show` is strictly
-- TRUE iff both tracks are 'missing' and FALSE in every other state.
-- Also aligns fn_billable_version_bump() with optimistic CAS (`expectedVersion + 1`).

ALTER TABLE public.timesheets
  DROP COLUMN IF EXISTS is_no_show;

ALTER TABLE public.timesheets
  ADD COLUMN is_no_show boolean NOT NULL GENERATED ALWAYS AS (
    COALESCE(
      arrival_track = 'missing'::public.attendance_arrival_track
      AND departure_track = 'missing'::public.attendance_departure_track,
      false
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_timesheets_no_show
  ON public.timesheets (organization_id, employee_id)
  WHERE is_no_show = true;

CREATE OR REPLACE FUNCTION public.fn_billable_version_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

