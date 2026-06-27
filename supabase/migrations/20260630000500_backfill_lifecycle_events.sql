-- =============================================================================
-- Shift Audit System — one-time backfill of lifecycle events for EXISTING shifts.
-- =============================================================================
-- The create/clock-out/complete capture (20260630000400) is forward-looking, so
-- shifts that predate it have sparse timelines. This synthesises the missing
-- origin / departure / completion events from the shifts table's own columns so
-- historical shifts read end-to-end.
--
-- Idempotent: every INSERT is guarded by NOT EXISTS, and tagged
-- metadata.source='backfill_lifecycle_20260630' for traceability / rollback
-- (DELETE ... WHERE metadata->>'source' = 'backfill_lifecycle_20260630').
-- =============================================================================

-- 1. CREATED — one per shift, at created_at. Neutral OP_APPLIED (employee_id may
--    be NULL; the validator exempts OP_APPLIED). No to_state: the at-creation
--    assignment is not reconstructable, so we don't imply one.
INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
SELECT
  s.id,
  s.assigned_employee_id,
  s.created_by_user_id,
  'OP_APPLIED'::public.shift_event_type,
  COALESCE(s.created_at, now()),
  jsonb_build_object('op', 'create', 'domain', 'lifecycle', 'source', 'backfill_lifecycle_20260630'),
  CASE WHEN s.created_by_user_id IS NULL THEN 'system' ELSE 'manager' END,
  'lifecycle'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.shift_events e
    WHERE e.shift_id = s.id AND e.metadata->>'op' = 'create'
  );

-- 2. CLOCK-OUT — for shifts with a recorded actual_end and an assigned worker.
--    EARLY_OUT (feeds the early-out metric) when they left >5m early, else a
--    neutral OP_APPLIED carrying the departure classification.
INSERT INTO public.shift_events (shift_id, employee_id, actor_id, event_type, event_time, metadata, actor_role, domain)
SELECT
  s.id,
  s.assigned_employee_id,
  s.assigned_employee_id,
  CASE WHEN s.end_at IS NOT NULL AND s.actual_end < s.end_at - INTERVAL '5 minutes'
       THEN 'EARLY_OUT' ELSE 'OP_APPLIED' END::public.shift_event_type,
  s.actual_end,
  jsonb_build_object(
    'op', 'clock_out', 'domain', 'attendance', 'source', 'backfill_lifecycle_20260630',
    'departure', CASE
                   WHEN s.end_at IS NOT NULL AND s.actual_end < s.end_at - INTERVAL '5 minutes' THEN 'early'
                   WHEN s.end_at IS NOT NULL AND s.actual_end > s.end_at + INTERVAL '5 minutes' THEN 'late'
                   ELSE 'on_time'
                 END
  ),
  'employee',
  'attendance'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND s.actual_end IS NOT NULL
  AND s.assigned_employee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.shift_events e
    WHERE e.shift_id = s.id
      AND (e.metadata->>'op' = 'clock_out' OR e.event_type = 'EARLY_OUT')
  );

-- 3. COMPLETED — for shifts in lifecycle 'Completed', at the latest available
--    end timestamp (>= the clock-out, so it sorts after it). Neutral OP_APPLIED.
INSERT INTO public.shift_events (shift_id, employee_id, event_type, event_time, metadata, domain)
SELECT
  s.id,
  s.assigned_employee_id,
  'OP_APPLIED'::public.shift_event_type,
  GREATEST(s.actual_end, s.end_at, s.updated_at),
  jsonb_build_object('op', 'complete', 'domain', 'lifecycle', 'to_state', 'S13', 'source', 'backfill_lifecycle_20260630'),
  'lifecycle'
FROM public.shifts s
WHERE s.deleted_at IS NULL
  AND s.lifecycle_status = 'Completed'
  AND NOT EXISTS (
    SELECT 1 FROM public.shift_events e
    WHERE e.shift_id = s.id AND e.metadata->>'op' = 'complete'
  );
