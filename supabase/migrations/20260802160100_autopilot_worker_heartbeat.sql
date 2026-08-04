-- ============================================================================
-- AutoPilot RDT engine — worker heartbeat.
--
-- Each autonomous worker (bids / swaps) pings on every SUCCESSFUL tick. The
-- return-to-manager sweep (20260802160200) treats a stale heartbeat as
-- "AutoPilot unavailable" and hands currently bot-owned items back to managers,
-- so a crashed worker never freezes queued work overnight.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.autopilot_worker_heartbeat (
  domain     text PRIMARY KEY,          -- 'bids' | 'swaps'
  worker     text,                      -- last worker id that pinged
  last_ok_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autopilot_worker_heartbeat ENABLE ROW LEVEL SECURITY;

-- gamma+ managers (and admins) can read worker health for the dashboard.
DROP POLICY IF EXISTS autopilot_heartbeat_read ON public.autopilot_worker_heartbeat;
CREATE POLICY autopilot_heartbeat_read ON public.autopilot_worker_heartbeat
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_access_certificates c
      WHERE c.user_id = auth.uid() AND c.is_active = true
        AND c.access_level IN ('gamma', 'delta', 'epsilon', 'zeta')
    )
  );

REVOKE ALL ON public.autopilot_worker_heartbeat FROM PUBLIC, anon;
GRANT SELECT ON public.autopilot_worker_heartbeat TO authenticated;
GRANT ALL    ON public.autopilot_worker_heartbeat TO service_role;

-- ── Ping RPC (service-role only) — upsert-by-domain. ────────────────────────
CREATE OR REPLACE FUNCTION public.autopilot_heartbeat_ping(p_domain text, p_worker text)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $$
  INSERT INTO public.autopilot_worker_heartbeat(domain, worker, last_ok_at, updated_at)
  VALUES (p_domain, p_worker, now(), now())
  ON CONFLICT (domain) DO UPDATE
    SET worker = EXCLUDED.worker, last_ok_at = now(), updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.autopilot_heartbeat_ping(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autopilot_heartbeat_ping(text, text) TO service_role;

COMMENT ON FUNCTION public.autopilot_heartbeat_ping(text, text) IS
  'AutoPilot worker liveness ping (service-role). domain=bids|swaps. Consumed by autopilot_return_stale_ownership().';
