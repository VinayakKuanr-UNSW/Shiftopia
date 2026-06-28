-- =============================================================================
-- Shift Audit System — backfill states for historical trigger events + clean up duplicate backfills.
-- =============================================================================

-- 1. Backfill from_state and to_state on existing shift_events that are missing them.
--    This maps historical trigger events (ASSIGNED, EMERGENCY_ASSIGNED, CHECKED_IN, etc.)
--    to their correct FSM state changes so they show correct states instead of dashes.
UPDATE public.shift_events se
SET metadata = COALESCE(se.metadata, '{}'::jsonb) || jsonb_build_object(
    'from_state', 
    CASE
        WHEN se.event_type = 'ASSIGNED' THEN 'S1'
        WHEN se.event_type = 'EMERGENCY_ASSIGNED' THEN 'S2'
        WHEN se.event_type IN ('CHECKED_IN', 'LATE_IN') THEN 'S4'
        WHEN se.event_type = 'EARLY_OUT' OR se.metadata->>'op' = 'clock_out' THEN 'S11'
        WHEN se.metadata->>'op' = 'create' THEN null
        ELSE 'S11'
    END,
    'to_state',
    CASE
        WHEN se.event_type = 'ASSIGNED' THEN 'S2'
        WHEN se.event_type = 'EMERGENCY_ASSIGNED' THEN 'S4'
        WHEN se.event_type IN ('CHECKED_IN', 'LATE_IN') THEN 'S11'
        WHEN se.event_type = 'EARLY_OUT' OR se.metadata->>'op' = 'clock_out' THEN 'S11'
        WHEN se.metadata->>'op' = 'create' THEN CASE WHEN s.assigned_employee_id IS NULL THEN 'S1' ELSE 'S2' END
        ELSE 'S13'
    END
)
FROM public.shifts s
WHERE s.id = se.shift_id
  AND (se.metadata->>'from_state' IS NULL OR se.metadata->>'to_state' IS NULL);

-- 2. Delete redundant backfilled publish and in_progress events for the two active shifts.
--    Since their actual trigger events (EMERGENCY_ASSIGNED and LATE_IN/CHECKED_IN) now
--    correctly carry the state transition (S2->S4 and S4->S11), the generic backfilled
--    rows are duplicate and cause visual noise.
DELETE FROM public.shift_events
WHERE id IN (
    '2595f526-9e12-45d2-b6e2-0a5e91adf16b', -- publish on abc81d9b
    '1a2a1278-bb5e-4201-88c0-d4315577af4d', -- publish on abc81d9b
    '0d16f8d5-6a34-4527-b807-fb61f13ae22d', -- in_progress on abc81d9b
    '44accba7-3065-4563-9b0d-a1c1c42ab7de', -- publish on 886fae1e
    'a8c67d67-95f8-4d9f-894e-dcbf732b93d5'  -- in_progress on 886fae1e
);
