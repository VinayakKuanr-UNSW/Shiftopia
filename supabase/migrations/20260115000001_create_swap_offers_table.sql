-- Create swap_offers table to handle multiple offers per swap request
CREATE TABLE IF NOT EXISTS swap_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    swap_request_id uuid NOT NULL REFERENCES swap_requests(id) ON DELETE CASCADE,
    offering_employee_id uuid NOT NULL, -- The employee making the offer
    offered_shift_id uuid REFERENCES shifts(id), -- The shift they are offering in exchange (optional)
    status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')) DEFAULT 'pending',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX idx_swap_offers_request ON swap_offers(swap_request_id);
CREATE INDEX idx_swap_offers_employee ON swap_offers(offering_employee_id);

-- Enable RLS
ALTER TABLE swap_offers ENABLE ROW LEVEL SECURITY;

-- Policies
-- 1. Anyone can read offers (or restricted to relevant parties, but open for now for simplicity)
CREATE POLICY "Users can view offers"
    ON swap_offers FOR SELECT
    TO authenticated
    USING (true);

-- 2. authenticated users can insert offers
CREATE POLICY "Users can create offers"
    ON swap_offers FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = (
        SELECT id FROM profiles WHERE legacy_employee_id = offering_employee_id
    ) OR EXISTS (
        -- Allow if user's ID matches the offering_employee_id (for non-legacy users)
        SELECT 1 WHERE auth.uid()::text = offering_employee_id::text
    ));

-- 3. Users can update their own offers (withdraw) OR the swap owner can accept/reject
CREATE POLICY "Users can update offers"
    ON swap_offers FOR UPDATE
    TO authenticated
    USING (true); -- Logic handled in application/RPC, or verify user is owner of offer OR owner of swap_request
