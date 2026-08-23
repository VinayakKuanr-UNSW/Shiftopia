-- ============================================================================
-- The cancellation split is at 24 HOURS, not 4.
--
-- 4h is the URGENT/EMERGENT boundary — the point at which the app blocks
-- exchange operations entirely (EMERGENT_WINDOW_MS in bidding-urgency.ts, and
-- the drop button's own lockout). The three shift urgency bands are:
--
--   TTS > 24h        normal
--   4h < TTS <= 24h  urgent
--   TTS <= 4h        emergent   (self-service blocked)
--
-- v_shift_assignment_episodes split cancelled_standard from cancelled_late at
-- 4h, which put the CANCELLATION boundary inside the window where an employee
-- cannot cancel at all. Every self-service cancellation therefore graded as
-- 'standard', and cancelled_late could only ever arrive from a manager or
-- override path.
--
-- Two cancellation kinds, split at 24h:
--   dropped with MORE than 24h notice  -> standard
--   dropped with 24h or less           -> critical
--
-- The view is patched from its own live definition by string replacement
-- rather than retyped, so the other 10.8kB cannot drift. The guard aborts if
-- the literal is not found exactly once.
-- ============================================================================

DO $$
DECLARE
    v_def  text;
    v_hits int;
BEGIN
    v_def := pg_get_viewdef('public.v_shift_assignment_episodes'::regclass, true);

    SELECT count(*) INTO v_hits
    FROM regexp_matches(v_def, '''04:00:00''::interval', 'g');

    IF v_hits <> 1 THEN
        RAISE EXCEPTION
            'expected exactly one ''04:00:00''::interval in v_shift_assignment_episodes, found %', v_hits;
    END IF;

    EXECUTE 'CREATE OR REPLACE VIEW public.v_shift_assignment_episodes AS '
            || replace(v_def, '''04:00:00''::interval', '''24:00:00''::interval');
END $$;

COMMENT ON VIEW public.v_shift_assignment_episodes IS
    'Assignment episodes with terminal outcomes. The late_cancel_threshold CTE '
    'splits cancelled_standard from cancelled_late at 24h — the standard/critical '
    'cancellation boundary. 4h is a different line: the urgent/emergent boundary, '
    'where the app blocks exchange operations.';
