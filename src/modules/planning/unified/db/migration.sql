-- =============================================================================
-- Unified Planning Request System — Database Migration
-- =============================================================================
--
-- Run this migration once against your Supabase project.
-- All DDL is idempotent (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Objects created:
--   1. workflow_status column on shifts
--   2. planning_requests table
--   3. planning_offers table
--   4. Indexes for performance and uniqueness
--   5. updated_at trigger for planning_requests


-- =============================================================================
-- 1. ADD workflow_status TO shifts
-- =============================================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS workflow_status text
    NOT NULL
    DEFAULT 'IDLE'
    CHECK (workflow_status IN (
      'IDLE',
      'OPEN_FOR_BIDS',
      'OPEN_FOR_TRADE',
      'PENDING_APPROVAL',
      'LOCKED'
    ));


-- =============================================================================
-- 2. planning_requests TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS planning_requests (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request classification
  type                    text        NOT NULL
    CHECK (type IN ('BID', 'SWAP')),

  -- Lifecycle state — no EVALUATING state; compliance runs synchronously
  status                  text        NOT NULL DEFAULT 'OPEN'
    CHECK (status IN (
      'OPEN',
      'MANAGER_PENDING',
      'APPROVED',
      'REJECTED',
      'BLOCKED',
      'CANCELLED',
      'EXPIRED'
    )),

  -- The shift being bid on / traded away by the initiator
  shift_id                uuid        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,

  -- Employee who created this request
  initiated_by            uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  -- For SWAP: the employee whose shift was selected; populated on offer selection
  -- For BID:  populated with the winning bidder on offer selection
  -- NULL while status = OPEN (unless targeted SWAP where known up front)
  target_employee_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,

  -- Free-text reason supplied by the initiator
  reason                  text,

  -- Compliance snapshot persisted at offer-selection time (JSONB for flexibility)
  compliance_snapshot     jsonb,
  compliance_evaluated_at timestamptz,

  -- Manager decision fields
  manager_id              uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  manager_notes           text,
  decided_at              timestamptz,

  -- Operational Log Entries
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- BID requests must NOT have a target shift (target_employee_id may be set for targeted bids)
  -- This is enforced at the application layer; no DB constraint needed for shift_id

  -- SWAP requests that have moved past OPEN must have a target_employee_id
  -- (enforced in application logic; too complex for a simple CHECK)

  CONSTRAINT chk_bid_no_target_shift CHECK (
    -- BID requests cannot reference a second shift — the shift_id IS the open shift
    -- We don't store a "target_shift_id" on the request for BID type
    type != 'BID' OR true  -- placeholder; actual enforcement is in app layer
  )
);

COMMENT ON TABLE planning_requests IS
  'Unified planning requests for both BID and SWAP workflows. '
  'One request per shift per lifecycle. Compliance snapshot stored at selection time.';

COMMENT ON COLUMN planning_requests.type IS
  'BID = employee requests an open shift; SWAP = employee offers to trade their shift.';

COMMENT ON COLUMN planning_requests.compliance_snapshot IS
  'JSON blob: BidComplianceSnapshot or SwapComplianceSnapshot depending on type. '
  'Populated at the moment an offer is selected, before manager decision.';


-- =============================================================================
-- 3. planning_offers TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS planning_offers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to the parent request
  request_id       uuid        NOT NULL REFERENCES planning_requests(id) ON DELETE CASCADE,

  -- The employee making this offer
  offered_by       uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  -- For SWAP: the shift the offerer is willing to give up.
  -- NULL for BID offers (no shift to trade, just applying).
  offered_shift_id uuid        REFERENCES shifts(id) ON DELETE SET NULL,

  -- Offer lifecycle
  status           text        NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'SUBMITTED',
      'SELECTED',
      'REJECTED',
      'WITHDRAWN'
    )),

  -- History Storage
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE planning_offers IS
  'One row per employee who responds to a planning_request. '
  'For BID: just a claim (offered_shift_id is NULL). '
  'For SWAP: offered_shift_id is the shift the responder trades away.';


-- =============================================================================
-- 4. INDEXES
-- =============================================================================

-- Only one active (non-terminal) request per shift.
-- Terminal statuses: APPROVED, REJECTED, BLOCKED, CANCELLED, EXPIRED
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_request_per_shift
  ON planning_requests (shift_id)
  WHERE status NOT IN ('APPROVED', 'REJECTED', 'BLOCKED', 'CANCELLED', 'EXPIRED');

-- Only one active SWAP request per target shift (the shift being offered in the swap).
-- We derive "target shift" from the selected offer's offered_shift_id, which is
-- reflected in planning_offers. The application enforces single-active-offer-per-shift
-- at the service layer. This index covers the request side for the initiator's shift.

-- Prevent offering the same shift into multiple active swap requests simultaneously.
-- An offer is "active" when status = SUBMITTED or SELECTED.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_offer_per_offered_shift
  ON planning_offers (offered_shift_id)
  WHERE offered_shift_id IS NOT NULL
    AND status IN ('SUBMITTED', 'SELECTED');

-- Fast lookup: find the single selected offer for any request
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_offers_selected
  ON planning_offers (request_id)
  WHERE status = 'SELECTED';

-- Fast lookup: all offers for a given request (used by manager views)
CREATE INDEX IF NOT EXISTS idx_planning_offers_request_id
  ON planning_offers (request_id);

-- Fast lookup: requests initiated by a specific employee
CREATE INDEX IF NOT EXISTS idx_planning_requests_initiated_by
  ON planning_requests (initiated_by);

-- Fast lookup: requests in a specific status (manager dashboard)
CREATE INDEX IF NOT EXISTS idx_planning_requests_status
  ON planning_requests (status)
  WHERE status IN ('OPEN', 'MANAGER_PENDING');


-- =============================================================================
-- 5. updated_at TRIGGER FOR planning_requests
-- =============================================================================

-- Generic trigger function (create once; reuse across tables)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Attach to planning_requests
DROP TRIGGER IF EXISTS trg_planning_requests_updated_at ON planning_requests;
CREATE TRIGGER trg_planning_requests_updated_at
  BEFORE UPDATE ON planning_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Attach to planning_offers
DROP TRIGGER IF EXISTS trg_planning_offers_updated_at ON planning_offers;
CREATE TRIGGER trg_planning_offers_updated_at
  BEFORE UPDATE ON planning_offers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
