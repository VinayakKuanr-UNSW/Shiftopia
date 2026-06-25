-- Shift mutation gateway — part 1/3: actor provenance on shift_events.
--
-- shift_events.employee_id is the SUBJECT (the worker the event is ABOUT), not
-- the person who performed the mutation. The optimistic-concurrency gateway
-- (sm_apply_shift_op) needs to record WHO acted (a manager / admin / service
-- role), so we add a dedicated actor_id column that references profiles(id).
--
-- Also add a (shift_id, event_time DESC) index so the gateway's idempotency
-- probe and per-shift event history reads are cheap.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.shift_events
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.shift_events.actor_id IS
  'The profile that PERFORMED this event (manager/admin/service). Distinct from employee_id, which is the worker the event is ABOUT.';

CREATE INDEX IF NOT EXISTS idx_shift_events_shift_id_event_time_desc
  ON public.shift_events (shift_id, event_time DESC);
