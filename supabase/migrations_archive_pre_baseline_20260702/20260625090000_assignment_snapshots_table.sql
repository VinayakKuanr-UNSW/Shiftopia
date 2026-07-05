-- =====================================================================
-- AssignmentSnapshot spine — Part 1 of 2: the snapshot table.
-- =====================================================================
-- A "snapshot" = ONE published-active assignment episode (the KPI spine).
--
-- An episode in v_shift_assignment_episodes is "published-active" iff
--     (had_accept OR had_emergency OR had_swap_in)
-- i.e. the holder became a CONFIRMED owner via one of:
--     • offer-accept   (publish → confirm)
--     • bid-win        (winner selected via the gateway 'select_winner' op)
--     • emergency-fill (EMERGENCY_ASSIGNED)
--     • trade-approve  (SWAPPED_IN)
--
-- Draft (S2) edits, offer-only (S3 never accepted), rejected and ignored
-- episodes are NOT snapshots — they never reached published-active and are
-- intentionally excluded from this spine (see _parity/assignment_snapshots_README.md).
--
-- The table is a PROJECTION of v_shift_assignment_episodes, refreshed per-shift by
-- sm_refresh_shift_snapshots() (see 20260625090100_assignment_snapshots_projection.sql).
-- It exists to make KPI scoping (org / dept / sub-dept / date / employee) cheap —
-- the underlying view is correct but expensive to scan for dashboards.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.assignment_snapshots (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id          uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    -- The episode within the shift (gaps-and-islands sequence from the view).
    episode_seq       int  NOT NULL,
    employee_id       uuid NOT NULL,
    -- How the holder became a confirmed owner of this episode:
    --   'publish_confirm' | 'bid_win' | 'trade_approve' | 'emergency'
    source            text NOT NULL,
    -- Confirmation moment (first ACCEPTED / EMERGENCY_ASSIGNED / SWAPPED_IN).
    became_active_at  timestamptz NOT NULL,
    -- When the episode closed (NULL while still the current owner).
    ended_at          timestamptz,
    -- Why it ended:
    --   'worked' | 'dropped_std' | 'dropped_late' | 'no_show'
    --   | 'traded_out' | 'reassigned' | NULL (still open)
    end_reason        text,
    attended          bool NOT NULL DEFAULT false,
    late_in           bool NOT NULL DEFAULT false,
    early_out         bool NOT NULL DEFAULT false,
    -- TRUE for exactly one snapshot per shift: the current (still-open) owner.
    is_current        bool NOT NULL DEFAULT false,
    -- ─── Denormalised for fast KPI scoping (copied from the view/shift) ───────────
    organization_id   uuid,
    department_id     uuid,
    sub_department_id uuid,
    shift_date        date,
    scheduled_start   timestamptz,
    refreshed_at      timestamptz NOT NULL DEFAULT now(),
    -- One snapshot per (shift, episode); lets the projection upsert/replace cleanly.
    UNIQUE (shift_id, episode_seq)
);

ALTER TABLE public.assignment_snapshots OWNER TO postgres;

-- At most one current owner per shift (terminal_outcome = 'open' episode).
CREATE UNIQUE INDEX IF NOT EXISTS one_current_owner_per_shift
    ON public.assignment_snapshots (shift_id) WHERE is_current;

-- Per-employee timeline scans (Performance page, reliability windows).
CREATE INDEX IF NOT EXISTS asnap_emp_idx
    ON public.assignment_snapshots (employee_id, became_active_at);

-- Org / dept / sub-dept / date scoping for KPI dashboards.
CREATE INDEX IF NOT EXISTS asnap_scope_idx
    ON public.assignment_snapshots (organization_id, department_id, sub_department_id, shift_date);

-- ─── RLS — permissive, mirroring shift_events / employee_performance_metrics ──────
-- Consistent with the existing event-sourced surfaces in this repo: GRANT ALL to the
-- three standard roles, ENABLE RLS, and add permissive policies. The projection
-- function is SECURITY DEFINER so it writes regardless of these policies; the policies
-- exist so the read path (dashboards) and any service writer behave like the rest of
-- the ledger surfaces. (Documented as permissive-by-design in perf_hygiene NOTE.)
GRANT ALL ON TABLE public.assignment_snapshots TO anon;
GRANT ALL ON TABLE public.assignment_snapshots TO authenticated;
GRANT ALL ON TABLE public.assignment_snapshots TO service_role;

ALTER TABLE public.assignment_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user (matches employee_performance_metrics' permissive
-- "Authenticated users can view performance metrics" policy; this is KPI-spine data).
DROP POLICY IF EXISTS "Authenticated users can view assignment snapshots"
    ON public.assignment_snapshots;
CREATE POLICY "Authenticated users can view assignment snapshots"
    ON public.assignment_snapshots
    FOR SELECT TO authenticated
    USING (true);

-- INSERT/UPDATE/DELETE: permissive (true). Same posture as shift_events /
-- employee_performance_metrics — the canonical writer is the SECURITY DEFINER
-- projection function; these keep any direct service write unblocked.
DROP POLICY IF EXISTS "System can insert assignment snapshots"
    ON public.assignment_snapshots;
CREATE POLICY "System can insert assignment snapshots"
    ON public.assignment_snapshots
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "System can update assignment snapshots"
    ON public.assignment_snapshots;
CREATE POLICY "System can update assignment snapshots"
    ON public.assignment_snapshots
    FOR UPDATE TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "System can delete assignment snapshots"
    ON public.assignment_snapshots;
CREATE POLICY "System can delete assignment snapshots"
    ON public.assignment_snapshots
    FOR DELETE TO authenticated
    USING (true);

COMMENT ON TABLE public.assignment_snapshots IS
    'AssignmentSnapshot KPI spine: one row per PUBLISHED-ACTIVE assignment episode '
    '(had_accept OR had_emergency OR had_swap_in) projected from v_shift_assignment_episodes. '
    'Draft (S2) edits and offer-only / rejected / ignored episodes are intentionally excluded. '
    'Refreshed per-shift by sm_refresh_shift_snapshots() on every shift_events insert.';

COMMENT ON COLUMN public.assignment_snapshots.source IS
    'How the holder became confirmed: publish_confirm | bid_win | trade_approve | emergency.';
COMMENT ON COLUMN public.assignment_snapshots.became_active_at IS
    'Confirmation moment: first ACCEPTED / EMERGENCY_ASSIGNED / SWAPPED_IN in the episode '
    '(falls back to opened_at if the view yields NULL — see projection function).';
COMMENT ON COLUMN public.assignment_snapshots.end_reason IS
    'worked | dropped_std | dropped_late | no_show | traded_out | reassigned | NULL(open).';
COMMENT ON COLUMN public.assignment_snapshots.is_current IS
    'TRUE for the still-open owner (terminal_outcome = open); enforced unique per shift.';
