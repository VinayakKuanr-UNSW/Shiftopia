-- Tests for Tiered Offer Expiry (Formula B)
-- Run inside a transaction that rolls back.

DO $$
DECLARE
  v_base timestamptz := '2026-11-10 10:00:00+11';
  v_res  timestamptz;
BEGIN
  -- Tier 1: TTS = 72h -> base + 24h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '72 hours', v_base);
  ASSERT v_res = v_base + interval '24 hours',
    format('TTS=72h failed: expected %s, got %s', v_base + interval '24 hours', v_res);

  -- Tier 1 boundary: TTS = 36h 30m -> min(24h, 36.5h - 12h = 24.5h) = 24h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '36.5 hours', v_base);
  ASSERT v_res = v_base + interval '24 hours',
    format('TTS=36.5h failed: expected %s, got %s', v_base + interval '24 hours', v_res);

  -- Tier 1 reserve guarantee: TTS = 36h 5m -> min(24h, 36h 5m - 12h = 24h 5m) = 24h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '36 hours 5 minutes', v_base);
  ASSERT v_res = v_base + interval '24 hours',
    format('TTS=36h5m failed: expected %s, got %s', v_base + interval '24 hours', v_res);

  -- Tier 2: TTS = 36h -> min(8h, 36h - 4h = 32h) = 8h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '36 hours', v_base);
  ASSERT v_res = v_base + interval '8 hours',
    format('TTS=36h failed: expected %s, got %s', v_base + interval '8 hours', v_res);

  -- Tier 2: TTS = 24h -> min(8h, 24h - 4h = 20h) = 8h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '24 hours', v_base);
  ASSERT v_res = v_base + interval '8 hours',
    format('TTS=24h failed: expected %s, got %s', v_base + interval '8 hours', v_res);

  -- Tier 2 boundary: TTS = 12h 30m -> min(8h, 12.5h - 4h = 8.5h) = 8h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '12.5 hours', v_base);
  ASSERT v_res = v_base + interval '8 hours',
    format('TTS=12.5h failed: expected %s, got %s', v_base + interval '8 hours', v_res);

  -- Tier 3: TTS = 12h -> min(2h, 12h) = 2h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '12 hours', v_base);
  ASSERT v_res = v_base + interval '2 hours',
    format('TTS=12h failed: expected %s, got %s', v_base + interval '2 hours', v_res);

  -- Tier 3: TTS = 6h -> min(2h, 6h) = 2h
  v_res := public.fn_calculate_offer_deadline(v_base + interval '6 hours', v_base);
  ASSERT v_res = v_base + interval '2 hours',
    format('TTS=6h failed: expected %s, got %s', v_base + interval '2 hours', v_res);

  -- Tier 3 short notice: TTS = 1h -> min(2h, 1h) = 1h (shift start)
  v_res := public.fn_calculate_offer_deadline(v_base + interval '1 hour', v_base);
  ASSERT v_res = v_base + interval '1 hour',
    format('TTS=1h failed: expected %s, got %s', v_base + interval '1 hour', v_res);

  -- Past shift: TTS = -1h -> returns shift start
  v_res := public.fn_calculate_offer_deadline(v_base - interval '1 hour', v_base);
  ASSERT v_res = v_base - interval '1 hour',
    format('TTS=-1h failed: expected %s, got %s', v_base - interval '1 hour', v_res);

  RAISE NOTICE 'ALL TIERED OFFER EXPIRY ASSERTIONS PASSED';
END $$;
