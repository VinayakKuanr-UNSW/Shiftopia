-- Availability Exceptions
-- =======================
-- The employee-facing half of `availability_overrides` — the solver channel
-- that has existed, fully implemented, since the optimizer was written and has
-- never had a single producer.
--
-- WHAT IT IS FOR. Permanents are regulated by their leave, not by an offer of
-- availability, so the one thing they genuinely need to express on the
-- availability page is the EXCEPTION: "I have a medical appointment on the
-- 4th", "please don't roster me nights in September", "Tuesday afternoons I'm
-- at study". None of those are leave — no balance is consumed, no approval is
-- owed — and none of them can be said today.
--
-- WHY IT IS NOT AVAILABILITY. Saying it through `availability_rules` would
-- require declaring every hour you CAN work in order to carve out the hours you
-- cannot, and under HC-5d full containment a too-narrow declaration silently
-- un-rosters you. Five full-timers in production are in exactly that state from
-- a 2-hour seeded window. An exception is subtractive by construction, so it
-- cannot cause that failure.
--
-- ── SEVERITY, AND WHY EMPLOYEES CANNOT SET 'HARD' ───────────────────────────
--   PREFERENCE  1000c — a nudge. Self-service.
--   SOFT        5000c — routed around unless coverage is worth more. Self-service.
--   HARD        pre-filter block, the same tier as approved leave. NOT
--               self-service: it removes the person from consideration
--               outright, which is a decision the employer has to make, and
--               unlike leave it consumes no balance and leaves no audit trail
--               of having been granted. Manager-only, enforced in RLS below.
--
-- Everything here is additive. Nothing reads these rows until
-- `RosterFetcher.fetchAvailabilityExceptions` does, and an empty table produces
-- an empty override list, which is what the solver already receives today.

CREATE TABLE IF NOT EXISTS public.availability_exceptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- NULL = every day in the horizon. A recurrence beyond that is deliberately
  -- not modelled: `availability_rules` already owns recurrence, and a second
  -- expansion engine is how the two would drift.
  exception_date  date,
  start_time      time NOT NULL,
  end_time        time NOT NULL,

  severity        text NOT NULL DEFAULT 'SOFT',
  reason          text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT availability_exceptions_severity_check
    CHECK (severity IN ('HARD', 'SOFT', 'PREFERENCE')),
  -- A zero-length or backwards window is meaningless, and the solver's
  -- `end <= start` branch would read it as crossing midnight — silently
  -- penalising a span the employee never named.
  CONSTRAINT availability_exceptions_window_check
    CHECK (end_time > start_time)
);

COMMENT ON TABLE public.availability_exceptions IS
  'Subtractive availability: windows an employee should not be rostered into, '
  'fed to the solver as `availability_overrides`. Distinct from leave (no '
  'balance, no approval) and from availability_rules (which is additive). '
  'HARD severity is manager-only — see the RLS policies.';
COMMENT ON COLUMN public.availability_exceptions.exception_date IS
  'NULL applies the window to EVERY day in the optimization horizon.';

CREATE INDEX IF NOT EXISTS availability_exceptions_profile_date_idx
  ON public.availability_exceptions (profile_id, exception_date);

-- One window per person per date per severity. Without it a double-submit
-- stacks penalties: two SOFT rows on the same day cost 10000c, which crosses
-- into territory the employee never asked for.
CREATE UNIQUE INDEX IF NOT EXISTS availability_exceptions_uniq
  ON public.availability_exceptions
     (profile_id, COALESCE(exception_date, '0001-01-01'::date), start_time, end_time, severity);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS availability_exceptions_select ON public.availability_exceptions;
CREATE POLICY availability_exceptions_select
  ON public.availability_exceptions FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above());

-- INSERT/UPDATE: your own rows, and only at a severity you are allowed to set.
-- The severity test is in WITH CHECK rather than a trigger so it applies to the
-- row as written, and cannot be sidestepped by updating a PREFERENCE row up to
-- HARD after the fact.
DROP POLICY IF EXISTS availability_exceptions_insert ON public.availability_exceptions;
CREATE POLICY availability_exceptions_insert
  ON public.availability_exceptions FOR INSERT TO authenticated
  WITH CHECK (
    (profile_id = (SELECT auth.uid()) AND severity IN ('SOFT', 'PREFERENCE'))
    OR is_manager_or_above()
  );

DROP POLICY IF EXISTS availability_exceptions_update ON public.availability_exceptions;
CREATE POLICY availability_exceptions_update
  ON public.availability_exceptions FOR UPDATE TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above())
  WITH CHECK (
    (profile_id = (SELECT auth.uid()) AND severity IN ('SOFT', 'PREFERENCE'))
    OR is_manager_or_above()
  );

-- DELETE stays open to the owner at any severity: withdrawing a restriction on
-- yourself only ever widens when you can be rostered, so it needs no guard.
DROP POLICY IF EXISTS availability_exceptions_delete ON public.availability_exceptions;
CREATE POLICY availability_exceptions_delete
  ON public.availability_exceptions FOR DELETE TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR is_manager_or_above());

-- Supabase grants table privileges to anon by default on new tables; RLS would
-- still block reads, but there is no reason for the grant to exist.
REVOKE ALL ON public.availability_exceptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_exceptions TO authenticated;

-- ── Verification (Supabase SQL Editor, after applying) ──────────────────────
--   -- expect 0 rows; nothing reads this until the fetcher ships
--   SELECT count(*) FROM public.availability_exceptions;
--
--   -- expect a check_violation: employees may not self-serve a HARD block
--   SET LOCAL ROLE authenticated;
--   INSERT INTO public.availability_exceptions (profile_id, start_time, end_time, severity)
--   VALUES (auth.uid(), '09:00', '17:00', 'HARD');
