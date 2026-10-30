-- ============================================================================
-- Timesheets — optimistic concurrency / row versioning (F18)
--
-- Two managers must not silently overwrite each other's edits. Every timesheet
-- carries a `version` that a BEFORE-UPDATE trigger bumps on EVERY write (manual
-- edit, bot approve, clock sync — anything). The client passes the version it
-- loaded; the write path adds `.eq('version', expected)` so a stale save matches
-- zero rows and is surfaced as a conflict ("refresh & review") instead of
-- clobbering the newer row.
--
-- The bump runs unconditionally (unlike edit_count, which only counts human
-- billable edits) so ANY concurrent write invalidates a stale editor.
-- ============================================================================

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.fn_timesheet_version_bump() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END; $$;

-- Runs alongside trg_timesheet_edit_count (both BEFORE UPDATE, independent
-- columns, order-insensitive).
DROP TRIGGER IF EXISTS trg_timesheet_version_bump ON public.timesheets;
CREATE TRIGGER trg_timesheet_version_bump
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION public.fn_timesheet_version_bump();

COMMENT ON COLUMN public.timesheets.version IS
  'Optimistic-lock row version, bumped on every UPDATE by trg_timesheet_version_bump. Clients pass the loaded version as a CAS guard (F18).';
