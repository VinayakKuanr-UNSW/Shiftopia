/*
  Add bidding_deadline column to shifts table
  
  This column stores when the bidding period ends for shifts that are
  pushed to bidding.
*/

-- Add bidding_deadline column to shifts table
ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS bidding_deadline TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_on_bidding BOOLEAN DEFAULT false;

-- Create index for efficient querying of bidding shifts
CREATE INDEX IF NOT EXISTS idx_shifts_bidding_deadline ON shifts(bidding_deadline)
WHERE is_on_bidding = true;

-- Add comment
COMMENT ON COLUMN shifts.bidding_deadline IS 'The deadline for employees to submit bids on this shift';
