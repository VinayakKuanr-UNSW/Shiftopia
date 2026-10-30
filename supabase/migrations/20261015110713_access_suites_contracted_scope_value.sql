-- Access suites, step 3 of 3, part 1: a scope for "wherever the caller is contracted".
-- On its own because a new enum value cannot be used in the transaction that adds it;
-- the next migration uses it (beta's Timesheets, and user_has_action_in_scope).
ALTER TYPE public.rbac_scope ADD VALUE IF NOT EXISTS 'CONTRACTED';
