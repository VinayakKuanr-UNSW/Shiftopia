-- Create a unique index to ensure only one active swap request exists per shift
-- Active means status is NOT 'cancelled' or 'rejected'
CREATE UNIQUE INDEX unique_active_swap_request ON swap_requests (original_shift_id)
WHERE status NOT IN ('cancelled', 'rejected');
