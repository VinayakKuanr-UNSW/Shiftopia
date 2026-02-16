
-- Migration 001: Create State Machine Enums (No Transaction Block)

-- 1. Create shift_lifecycle enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_lifecycle') THEN
    CREATE TYPE shift_lifecycle AS ENUM (
      'Draft',
      'Published', 
      'InProgress',
      'Completed',
      'Cancelled'
    );
  END IF;
END $$;

-- 2. Create shift_trading enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_trading') THEN
    CREATE TYPE shift_trading AS ENUM (
      'NoTrade',
      'TradeRequested',
      'TradeAccepted',
      'TradeApproved'
    );
  END IF;
END $$;
