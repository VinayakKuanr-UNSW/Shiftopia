/*
  # Add Work Rights Verification Fields

  1. Schema Changes
    - Add verification fields to employee_licenses for VEVO/visa tracking
    - Add license_type to distinguish work rights from standard licenses
  
  2. New Columns
    - verification_status - Current verification state
    - verified_at - When verification was successful
    - last_checked_at - Last verification check timestamp
    - verification_metadata - JSON for storing verification details
    - license_type - Type of license (Standard, WorkRights, Professional)
  
  3. Indexes
    - Composite index on verification_status and license_type
*/

-- Add verification tracking columns to employee_licenses
ALTER TABLE employee_licenses 
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'Unverified' 
    CHECK (verification_status IN ('Unverified', 'Verified', 'Failed', 'Expired'));

ALTER TABLE employee_licenses 
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE employee_licenses 
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

ALTER TABLE employee_licenses 
  ADD COLUMN IF NOT EXISTS verification_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE employee_licenses 
  ADD COLUMN IF NOT EXISTS license_type text DEFAULT 'Standard' 
    CHECK (license_type IN ('Standard', 'WorkRights', 'Professional'));

-- Create index for efficient filtering by verification status and type
CREATE INDEX IF NOT EXISTS idx_employee_licenses_verification 
  ON employee_licenses(verification_status, license_type);
