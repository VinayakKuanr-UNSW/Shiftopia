-- =====================================================================
-- AssignmentSnapshot spine — Part 2 of 2: per-shift projection + trigger + backfill.
-- =====================================================================
-- Keeps public.assignment_snapshots in sync with v_shift_assignment_episodes.
--
-- Refresh is PER-SHIFT and cheap: the view is parameterised by shift_id via the
-- gaps-and-islands window, and a shift has only a handful of episodes. Every insert
-- into the immutable shift_events ledger re-derives that one shift's snapshots.
--
-- Published-active filter (the KPI spine definition):
--     (had_accept OR had_emergency OR had_swap_in)
--     AND terminal_outcome <> 'shift_deleted'
-- Offer-only / rejected / ignored / Draft(S2) episodes never satisfy this and are
-- intentionally excluded.
-- =====================================================================

-- ─── 1. Per-shift refresh: DELETE-then-INSERT from the episodes view ─────────────
CREATE OR REPLACE FUNCTION public.sm_refresh_shift_snapshots(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN;
    END IF;

    -- Idempotent: clear this shift's snapshots, then re-project. The episodes view is
    -- the single source of truth, so a full per-shift replace can never drift.
    DELETE FROM public.assignment_snapshots WHERE shift_id = p_shift_id;

    INSERT INTO public.assignment_snapshots (
        shift_id, episode_seq, employee_id, source,
        became_active_at, ended_at, end_reason,
        attended, late_in, early_out, is_current,
        organization_id, department_id, sub_department_id,
        shift_date, scheduled_start, refreshed_at
    )
    SELECT
        ep.shift_id,
        ep.episode_seq,
        ep.employee_id,
        -- ── source: how the holder became a confirmed owner ──────────────────────
        -- Priority: emergency > trade-in > bid-win > publish-confirm.
        --   emergency      ← EMERGENCY_ASSIGNED present in the episode.
        --   trade_approve  ← SWAPPED_IN present in the episode.
        --   bid_win        ← an ASSIGNED gateway audit event with metadata.op =
        --                    'select_winner' inside the episode window (the bidding
        --                    gateway stamps the true op in metadata; event_type is the
        --                    neutral 'ASSIGNED'). This is the ONLY reliable bid-win
        --                    signal in the ledger.
        --   publish_confirm← default (offer-accept path / undeterminable).
        CASE
            WHEN ep.had_emergency THEN 'emergency'
            WHEN ep.had_swap_in   THEN 'trade_approve'
            WHEN EXISTS (
                SELECT 1
                FROM public.shift_events se
                WHERE se.shift_id = ep.shift_id
                  AND se.event_type = 'ASSIGNED'
                  AND se.metadata->>'op' = 'select_winner'
                  -- bound to this episode's window so an earlier/later attempt on the
                  -- same shift can't leak its bid-win signal into a different episode.
                  AND se.event_time >= ep.opened_at
                  AND (ep.closed_at IS NULL OR se.event_time <= ep.closed_at)
            ) THEN 'bid_win'
            ELSE 'publish_confirm'
        END AS source,
        -- became_active_at: confirmation moment from the view; fall back to opened_at
        -- if NULL (defensive — published-active episodes always have a confirming
        -- event, but this keeps the NOT NULL column safe).
        COALESCE(ep.became_active_at, ep.opened_at) AS became_active_at,
        ep.closed_at AS ended_at,
        -- ── end_reason: map terminal_outcome → snapshot vocabulary ────────────────
        CASE
            WHEN ep.terminal_outcome = 'fulfilled'          THEN 'worked'
            WHEN ep.terminal_outcome = 'cancelled_standard' THEN 'dropped_std'
            WHEN ep.terminal_outcome = 'cancelled_late'     THEN 'dropped_late'
            WHEN ep.terminal_outcome = 'no_show'            THEN 'no_show'
            WHEN ep.terminal_outcome = 'swapped_out'        THEN 'traded_out'
            WHEN ep.terminal_outcome = 'unassigned'         THEN 'reassigned'
            -- 'open' on a NON-final published-active episode = the holder was
            -- superseded by a later episode with no explicit close event (e.g. an
            -- emergency reassignment). Treat it as closed/reassigned so it is NOT
            -- flagged current (two open episodes would otherwise both claim
            -- is_current and violate one_current_owner_per_shift).
            WHEN ep.terminal_outcome = 'open'
                 AND ep.episode_seq < MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id)
                                                            THEN 'reassigned'
            -- 'open' on the FINAL published-active episode = current active owner.
            WHEN ep.terminal_outcome = 'open'               THEN NULL
            ELSE NULL  -- defensive: rejected/ignored/shift_deleted are filtered out
        END AS end_reason,
        ep.attended,
        ep.late_in,
        ep.early_out,
        -- Only the FINAL still-open published-active episode is the current owner.
        (ep.terminal_outcome = 'open'
            AND ep.episode_seq = MAX(ep.episode_seq) OVER (PARTITION BY ep.shift_id))
                                                            AS is_current,
        ep.organization_id,
        ep.department_id,
        ep.sub_department_id,
        ep.shift_date,
        ep.scheduled_start,
        now() AS refreshed_at
    FROM public.v_shift_assignment_episodes ep
    WHERE ep.shift_id = p_shift_id
      -- ── published-active filter (the KPI spine definition) ──
      AND (ep.had_accept OR ep.had_emergency OR ep.had_swap_in)
      AND ep.terminal_outcome <> 'shift_deleted';
END;
$function$;

REVOKE ALL ON FUNCTION public.sm_refresh_shift_snapshots(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sm_refresh_shift_snapshots(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.sm_refresh_shift_snapshots(uuid) TO service_role;

COMMENT ON FUNCTION public.sm_refresh_shift_snapshots(uuid) IS
    'Re-projects public.assignment_snapshots for one shift from v_shift_assignment_episodes '
    '(published-active episodes only). Idempotent DELETE-then-INSERT; called on every '
    'shift_events insert via trg_refresh_snapshots and once per shift in the backfill.';

-- ─── 2. Trigger fn: refresh the affected shift on every ledger append ─────────────
CREATE OR REPLACE FUNCTION public.fn_refresh_snapshots_on_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Some audit events (e.g. neutral OP_APPLIED rows) may carry a NULL shift_id in
    -- principle; guard so the trigger is a no-op rather than an error in that case.
    IF NEW.shift_id IS NOT NULL THEN
        PERFORM public.sm_refresh_shift_snapshots(NEW.shift_id);
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_refresh_snapshots_on_event() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_refresh_snapshots ON public.shift_events;
CREATE TRIGGER trg_refresh_snapshots
    AFTER INSERT ON public.shift_events
    FOR EACH ROW
    -- Only events that can create/close/annotate a PUBLISHED-ACTIVE episode need a
    -- re-projection. OFFERED / REJECTED / IGNORED only affect offer-only episodes
    -- (never snapshots), so skipping them avoids a full per-shift rebuild on the
    -- highest-volume marketplace churn. A later ACCEPTED (etc.) always re-fires.
    WHEN (NEW.event_type IN (
        'ASSIGNED','EMERGENCY_ASSIGNED','ACCEPTED','SWAPPED_IN','SWAPPED_OUT',
        'UNASSIGNED','CANCELLED','LATE_CANCELLED','NO_SHOW',
        'CHECKED_IN','LATE_IN','EARLY_OUT'
    ))
    EXECUTE FUNCTION public.fn_refresh_snapshots_on_event();

COMMENT ON FUNCTION public.fn_refresh_snapshots_on_event() IS
    'AFTER INSERT trigger fn on shift_events: re-projects assignment_snapshots for the '
    'affected shift (guards NULL shift_id). Per-shift refresh is cheap.';

-- ─── 3. Backfill: project every live shift once (idempotent) ──────────────────────
-- sm_refresh_shift_snapshots is a full per-shift replace, so re-running this is safe.
-- Deleted shifts are skipped (their episodes are 'shift_deleted' and excluded anyway).
DO $backfill$
DECLARE
    v_shift_id uuid;
BEGIN
    FOR v_shift_id IN
        SELECT id FROM public.shifts WHERE deleted_at IS NULL
    LOOP
        PERFORM public.sm_refresh_shift_snapshots(v_shift_id);
    END LOOP;
END;
$backfill$;
