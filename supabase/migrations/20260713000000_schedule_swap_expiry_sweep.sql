-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule the shift-swap expiry sweep every minute (pg_cron)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- (1) WHAT THIS FIXES
--     expire_locked_swaps() flips shift_swaps rows in status
--     OPEN / OFFER_SELECTED / MANAGER_PENDING whose expires_at <= NOW() to
--     EXPIRED, resets the requester shift to trading_status = 'NoTrade', and
--     marks the associated swap_offers EXPIRED. It was defined in the baseline
--     schema (20251015000000_baseline_schema.sql) but NOTHING in the repo's
--     migrations ever scheduled it — it only ran when the `shift-state-processor`
--     edge function (Pass 4) happened to fire. So in any environment where that
--     edge function is not deployed/scheduled, swaps NEVER auto-EXPIRED and stale
--     OPEN/OFFER_SELECTED/MANAGER_PENDING rows accumulated past their deadline.
--     This migration schedules the sweep to run every minute via pg_cron.
--
-- (2) IDEMPOTENT — SAFE TO DOUBLE-RUN
--     expire_locked_swaps() is idempotent: it only touches rows still past-due in
--     an active status, and rows already flipped to EXPIRED no longer match. So it
--     is safe even if the shift-state-processor edge function (Pass 4) is ALSO
--     scheduled in prod — running both drivers cannot double-expire or corrupt a
--     row; the second caller simply finds nothing left to do.
--
-- (3) REVIEWER NOTE
--     - pg_cron MUST be enabled in the target Supabase project for this to take
--       effect. If pg_cron is not installed this migration is a silent no-op
--       (guarded below) and the sweep must be driven elsewhere (edge function).
--     - ALTERNATIVE: process_shift_timers() step 5 also expires in-flight swaps
--       (at T-4h) and is the broader every-minute driver. If the team prefers to
--       schedule process_shift_timers() every minute instead, THAT job supersedes
--       this one for swaps (its step 5 covers the same expiry) — in that case,
--       DROP this 'swap_expiry_sweep' job to avoid redundant every-minute work.
--
-- pg_cron extension needs to be enabled in the Supabase dashboard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule only when the job exists — cron.unschedule RAISES on a
    -- missing job and would abort the whole migration on first apply.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'swap_expiry_sweep') THEN
      PERFORM cron.unschedule('swap_expiry_sweep');
    END IF;
    -- Schedule to run every minute.
    PERFORM cron.schedule('swap_expiry_sweep', '* * * * *', 'SELECT public.expire_locked_swaps();');
  END IF;
END $$;
