-- Drop SQL functions nothing calls: no app or edge-function reference, no SQL
-- caller, no cron job (checked 2026-10-25 against the live catalogue).
--
-- Seven of them INSERT or UPDATE shifts by name-listed columns. Every column a
-- shift gains has to be threaded through each live write path by hand, and a
-- dead path cannot be found by a test, so it is where a new column silently
-- goes missing the day someone revives it. Removing them leaves exactly four
-- live write paths into `shifts`: sm_create_shift, the gateway edit
-- (_apply_shift_op_write), apply_template_to_date_range_v2 and
-- clone_roster_subgroup_v2.
--
-- No CASCADE: if anything still depends on one of these, this migration fails
-- rather than taking the dependant with it.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'add_roster_shift',
              'apply_monthly_template',          -- three overloads
              'apply_template_to_date_range',    -- v1; v2 is live
              'auto_calculate_net_hours',
              'calculate_net_hours',             -- only auto_calculate_net_hours called it
              'calculate_shift_hours',
              'calculate_shift_length',          -- two overloads
              'clone_roster_subgroup',           -- v1; v2 is live
              'create_planning_period',
              'publish_roster_day',
              'publish_roster_shift',            -- only publish_roster_day called it
              'publish_roster_for_range',        -- its one caller, usePublishRoster, was removed
              'roster_calculate_net_hours',
              'sm_update_shift'                  -- two overloads; edits go through sm_apply_shift_op
          )
        ORDER BY p.proname
    LOOP
        EXECUTE format('DROP FUNCTION %s', r.sig);
    END LOOP;
END $$;
