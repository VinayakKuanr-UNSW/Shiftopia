-- ============================================================================
-- Availability requests — the tracked half of "ask someone to declare".
--
-- Until now the manager's "Request availability" action sent a notification and
-- forgot it. That cannot answer the three questions the action exists to raise:
-- who was asked, who responded, and when to stop asking. A notification is a
-- message; this is the record.
--
-- The loop closes WITHOUT any employee-side UI work: a trigger on
-- `availability_rules` marks any pending request whose period the new rule
-- overlaps as responded. The employee simply declares — as they always could —
-- and the request resolves itself.
--
-- This table never grants anyone the power to change someone's availability.
-- It records that a request was made and whether a declaration followed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.availability_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Who is being asked.
    profile_id        uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    -- Who asked.
    requested_by      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    -- The range the manager wants covered.
    period_start      date NOT NULL,
    period_end        date NOT NULL,
    note              text,
    status            text NOT NULL DEFAULT 'pending',
    created_at        timestamptz NOT NULL DEFAULT now(),
    responded_at      timestamptz,
    -- The declaration that closed it, when one did.
    responded_rule_id uuid REFERENCES public.availability_rules (id) ON DELETE SET NULL,
    cancelled_at      timestamptz,

    CONSTRAINT availability_requests_status_ck
        CHECK (status IN ('pending', 'responded', 'cancelled')),
    CONSTRAINT availability_requests_period_ck
        CHECK (period_end >= period_start)
);

COMMENT ON TABLE public.availability_requests IS
    'Manager requests for an employee to declare availability. Records the ask and whether a declaration followed; never changes availability itself.';

-- One OPEN request per (recipient, requester, period). A manager clicking twice
-- must not create a second row, but a genuinely new period always can — and a
-- resolved request never blocks re-asking later.
CREATE UNIQUE INDEX IF NOT EXISTS availability_requests_open_uq
    ON public.availability_requests (profile_id, requested_by, period_start, period_end)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS availability_requests_profile_status_idx
    ON public.availability_requests (profile_id, status);

CREATE INDEX IF NOT EXISTS availability_requests_period_idx
    ON public.availability_requests (period_start, period_end);

-- ── Auto-close on declaration ───────────────────────────────────────────────
-- A rule's coverage runs start_date .. coalesce(repeat_end_date, start_date);
-- a NULL repeat_end_date is an open-ended rule, not an expiring one (see the
-- retraction in docs/architecture/team-availability-page-plan.md §1.2), so a
-- non-repeating rule covers exactly its own day.

CREATE OR REPLACE FUNCTION public.trg_availability_rule_closes_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rule_end date;
BEGIN
    v_rule_end := COALESCE(NEW.repeat_end_date, NEW.start_date);

    UPDATE public.availability_requests r
       SET status            = 'responded',
           responded_at      = now(),
           responded_rule_id = NEW.id
     WHERE r.profile_id = NEW.profile_id
       AND r.status     = 'pending'
       -- Interval overlap, inclusive on both ends.
       AND NEW.start_date <= r.period_end
       AND v_rule_end     >= r.period_start;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_availability_rule_closes_request() IS
    'Marks pending availability_requests as responded when the employee declares a rule overlapping the requested period.';

DROP TRIGGER IF EXISTS availability_rule_closes_request ON public.availability_rules;
CREATE TRIGGER availability_rule_closes_request
    AFTER INSERT ON public.availability_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_availability_rule_closes_request();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;

-- Recipients see their own; managers see all. Note `TO authenticated` — a bare
-- policy defaults to PUBLIC, which includes `anon`, and that is exactly the
-- mistake this migration's sibling exists to correct.
DROP POLICY IF EXISTS availability_requests_select ON public.availability_requests;
CREATE POLICY availability_requests_select
    ON public.availability_requests
    FOR SELECT TO authenticated
    USING (profile_id = (SELECT auth.uid()) OR public.is_manager_or_above());

-- Only managers ask, and only ever as themselves.
DROP POLICY IF EXISTS availability_requests_insert ON public.availability_requests;
CREATE POLICY availability_requests_insert
    ON public.availability_requests
    FOR INSERT TO authenticated
    WITH CHECK (public.is_manager_or_above() AND requested_by = (SELECT auth.uid()));

-- Managers may cancel. Responding is the trigger's job, not a client's — an
-- employee must not be able to mark themselves as having answered.
DROP POLICY IF EXISTS availability_requests_update ON public.availability_requests;
CREATE POLICY availability_requests_update
    ON public.availability_requests
    FOR UPDATE TO authenticated
    USING (public.is_manager_or_above())
    WITH CHECK (public.is_manager_or_above());

REVOKE ALL ON public.availability_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.availability_requests TO authenticated;
GRANT ALL ON public.availability_requests TO service_role;

-- Supabase auto-grants EXECUTE to `authenticated` as well as PUBLIC/anon, so
-- revoking only the first two leaves a SECURITY DEFINER function callable over
-- /rest/v1/rpc by every signed-in user. A trigger function needs no EXECUTE
-- grant at all — the trigger runs as the table owner.
REVOKE ALL ON FUNCTION public.trg_availability_rule_closes_request()
    FROM PUBLIC, anon, authenticated;
