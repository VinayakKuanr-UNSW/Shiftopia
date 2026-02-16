
-- Migration 002: Add trading_status Column (No Transaction Block)

-- 1. Add trading_status column with default
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS trading_status shift_trading NOT NULL DEFAULT 'NoTrade';

-- 2. Backfill from is_trade_requested boolean
UPDATE shifts 
SET trading_status = CASE 
  WHEN is_trade_requested = true THEN 'TradeRequested'::shift_trading
  ELSE 'NoTrade'::shift_trading
END
WHERE trading_status = 'NoTrade';

-- 3. Create index
CREATE INDEX IF NOT EXISTS idx_shifts_trading_status 
ON shifts (trading_status) 
WHERE trading_status != 'NoTrade';
