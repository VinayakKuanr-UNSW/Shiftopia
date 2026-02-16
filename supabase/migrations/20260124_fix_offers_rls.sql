-- Migration: Fix RLS for Shift Offers
-- Description: Updates the select policy on shift_offers to correctly compare employee_id with auth.uid()
-- Previously it was comparing against a potentially legacy INT id from user_profiles.

BEGIN;

DROP POLICY IF EXISTS "Employees can view own shift offers" ON shift_offers;

CREATE POLICY "Employees can view own shift offers"
  ON shift_offers FOR SELECT
  TO authenticated
  USING (
    employee_id = auth.uid()
  );

COMMIT;
