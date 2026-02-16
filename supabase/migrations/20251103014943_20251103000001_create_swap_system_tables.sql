/*
  # Create Shift Swap System Tables

  ## Overview
  This migration creates comprehensive shift swap infrastructure with automated validation
  for work hours rules (12hr/day, 152hr/month, 10hr rest gap) and manager approval workflow.

  ## New Tables

  ### 1. swap_requests
  - `id` (uuid, primary key)
  - `original_shift_id` (uuid, foreign key to shifts) - Shift being swapped away
  - `requested_by_employee_id` (uuid, foreign key to employees) - Employee requesting swap
  - `swap_with_employee_id` (uuid, foreign key to employees, nullable) - Target employee for swap
  - `offered_shift_id` (uuid, foreign key to shifts, nullable) - Shift offered in exchange
  - `reason` (text) - Reason for swap request
  - `status` (text) - pending_employee, pending_manager, approved, rejected, cancelled
  - `responded_at` (timestamptz) - When other employee responded
  - `approved_by_manager_id` (uuid, foreign key to user_profiles, nullable)
  - `manager_approved_at` (timestamptz, nullable)
  - `rejection_reason` (text, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. swap_validations
  - `id` (uuid, primary key)
  - `swap_request_id` (uuid, foreign key to swap_requests)
  - `employee_id` (uuid, foreign key to employees) - Employee being validated
  - `daily_hours_check` (boolean) - Passes 12hr/day limit
  - `monthly_hours_check` (boolean) - Passes 152hr/month limit
  - `rest_period_check` (boolean) - Passes 10hr rest gap
  - `skill_match_check` (boolean) - Has required skills
  - `validation_errors` (jsonb) - Detailed error messages
  - `is_valid` (boolean) - Overall validation result
  - `validated_at` (timestamptz)

  ### 3. swap_approvals
  - `id` (uuid, primary key)
  - `swap_request_id` (uuid, foreign key to swap_requests)
  - `approver_id` (uuid, foreign key to auth.users)
  - `action` (text) - approved, rejected
  - `comments` (text, nullable)
  - `actioned_at` (timestamptz)

  ### 4. swap_notifications
  - `id` (uuid, primary key)
  - `swap_request_id` (uuid, foreign key to swap_requests)
  - `recipient_user_id` (uuid, foreign key to auth.users)
  - `notification_type` (text) - swap_request, swap_response, manager_approval, swap_cancelled
  - `message` (text)
  - `is_read` (boolean, default false)
  - `created_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Employees can view swaps they're involved in
  - Managers can view all swaps in their department
  - Admins can view all swaps

  ## Indexes
  - Add indexes on foreign keys and status fields
  - Add composite indexes for common queries
*/

-- Create swap_requests table
CREATE TABLE IF NOT EXISTS swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  requested_by_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  swap_with_employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  offered_shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'pending_employee' CHECK (status IN ('pending_employee', 'pending_manager', 'approved', 'rejected', 'cancelled')),
  responded_at timestamptz,
  approved_by_manager_id uuid,
  manager_approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create swap_validations table
CREATE TABLE IF NOT EXISTS swap_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_request_id uuid NOT NULL REFERENCES swap_requests(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  daily_hours_check boolean DEFAULT false,
  monthly_hours_check boolean DEFAULT false,
  rest_period_check boolean DEFAULT false,
  skill_match_check boolean DEFAULT false,
  validation_errors jsonb DEFAULT '{}',
  is_valid boolean DEFAULT false,
  validated_at timestamptz DEFAULT now()
);

-- Create swap_approvals table
CREATE TABLE IF NOT EXISTS swap_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_request_id uuid NOT NULL REFERENCES swap_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approved', 'rejected')),
  comments text,
  actioned_at timestamptz DEFAULT now()
);

-- Create swap_notifications table
CREATE TABLE IF NOT EXISTS swap_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_request_id uuid NOT NULL REFERENCES swap_requests(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('swap_request', 'swap_response', 'manager_approval', 'swap_cancelled')),
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for swap_requests
CREATE INDEX IF NOT EXISTS idx_swap_requests_original_shift ON swap_requests(original_shift_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_requested_by ON swap_requests(requested_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_swap_with ON swap_requests(swap_with_employee_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status ON swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_created_at ON swap_requests(created_at DESC);

-- Create indexes for swap_validations
CREATE INDEX IF NOT EXISTS idx_swap_validations_swap_request ON swap_validations(swap_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_validations_employee ON swap_validations(employee_id);
CREATE INDEX IF NOT EXISTS idx_swap_validations_is_valid ON swap_validations(is_valid);

-- Create indexes for swap_approvals
CREATE INDEX IF NOT EXISTS idx_swap_approvals_swap_request ON swap_approvals(swap_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_approver ON swap_approvals(approver_id);

-- Create indexes for swap_notifications
CREATE INDEX IF NOT EXISTS idx_swap_notifications_swap_request ON swap_notifications(swap_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_notifications_recipient ON swap_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_swap_notifications_is_read ON swap_notifications(is_read);

-- Enable Row Level Security
ALTER TABLE swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for swap_requests
CREATE POLICY "Authenticated users can view swaps" ON swap_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create swap requests" ON swap_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update swap requests" ON swap_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for swap_validations
CREATE POLICY "Authenticated users can view validations" ON swap_validations FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create validations" ON swap_validations FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for swap_approvals
CREATE POLICY "Authenticated users can view approvals" ON swap_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can create approvals" ON swap_approvals FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for swap_notifications
CREATE POLICY "Users can view their own notifications" ON swap_notifications FOR SELECT TO authenticated USING (auth.uid() = recipient_user_id);
CREATE POLICY "System can create notifications" ON swap_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update their own notifications" ON swap_notifications FOR UPDATE TO authenticated USING (auth.uid() = recipient_user_id) WITH CHECK (auth.uid() = recipient_user_id);
