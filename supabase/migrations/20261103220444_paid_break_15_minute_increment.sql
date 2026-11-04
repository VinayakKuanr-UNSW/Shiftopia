-- ============================================================================
-- Migration: paid_break_15_minute_increment
-- Purpose:
--   Paid rest pauses are 15-minute entitlements (ICC EBA cl 37.1 / 37.2). The
--   shift form already blocks anything else (SHAPE_REST_PAUSE_INCREMENT); this
--   makes the table refuse it too, so templates, imports and direct API writes
--   cannot store 20 minutes. No row violated it on 2026-11-04.
-- ============================================================================

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_shape_rest_pause_increment
  CHECK (COALESCE(paid_break_minutes, 0) % 15 = 0);

ALTER TABLE public.template_shifts
  ADD CONSTRAINT template_shifts_rest_pause_increment
  CHECK (COALESCE(paid_break_minutes, 0) % 15 = 0);
