/*
  # Create Shift Offers and Notifications System

  ## Overview
  This migration creates tables for managing shift offers to employees and a notification
  system to alert employees about new shift opportunities.

  ## New Tables

  ### 1. shift_offers
  Tracks shift offers sent to eligible employees
  - `id` (uuid, primary key)
  - `shift_id` (uuid, foreign key to shifts, not null)
  - `employee_id` (uuid, foreign key to employees, not null)
  - `status` (text, not null) - 'Pending', 'Accepted', 'Declined'
  - `offered_at` (timestamptz, default now())
  - `responded_at` (timestamptz, nullable)
  - `response_notes` (text, nullable)
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

  ### 2. notifications
  Stores notifications for users about various events
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, not null)
  - `type` (text, not null) - 'shift_offer', 'shift_update', 'swap_request', etc.
  - `title` (text, not null)
  - `message` (text, not null)
  - `link` (text, nullable) - Deep link to relevant page
  - `read_at` (timestamptz, nullable)
  - `created_at` (timestamptz, default now())

  ## Indexes
  - Indexes for foreign keys and common queries
  - Composite indexes for status filtering and date ranges

  ## Security
  - Enable RLS on all tables
  - Employees can view their own offers and notifications
  - Managers can view offers for shifts in their department
  - Admins can view all offers and notifications
*/

-- Create shift_offers table
CREATE TABLE IF NOT EXISTS shift_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('Pending', 'Accepted', 'Declined')) DEFAULT 'Pending',
  offered_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  response_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shift_id, employee_id)
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('shift_offer', 'shift_update', 'shift_cancelled', 'swap_request', 'swap_approved', 'bid_status', 'general')),
  title text NOT NULL,
  message text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Ensure shift_offers has required columns
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Declined'));
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS offered_at timestamptz DEFAULT now();
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS response_notes text;
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE shift_offers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Ensure notifications has required columns
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'general' CHECK (type IN ('shift_offer', 'shift_update', 'shift_cancelled', 'swap_request', 'swap_approved', 'bid_status', 'general'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Create indexes for shift_offers
CREATE INDEX IF NOT EXISTS idx_shift_offers_shift_id ON shift_offers(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_employee_id ON shift_offers(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_status ON shift_offers(status);
CREATE INDEX IF NOT EXISTS idx_shift_offers_offered_at ON shift_offers(offered_at);
CREATE INDEX IF NOT EXISTS idx_shift_offers_status_employee ON shift_offers(status, employee_id);

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

-- Enable Row Level Security
ALTER TABLE shift_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shift_offers

-- Employees can view their own offers
CREATE POLICY "Employees can view own shift offers"
  ON shift_offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.employee_id = shift_offers.employee_id
    )
  );

-- Managers can view offers for shifts in their department
CREATE POLICY "Managers can view department shift offers"
  ON shift_offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      INNER JOIN shifts s ON s.id = shift_offers.shift_id
      WHERE up.id = auth.uid()
      AND up.role IN ('admin', 'manager')
      AND (
        up.can_access_all_departments = true
        OR s.department_id = up.department_id
      )
    )
  );

-- Employees can update their own offers (accept/decline)
CREATE POLICY "Employees can respond to own offers"
  ON shift_offers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.employee_id = shift_offers.employee_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.employee_id = shift_offers.employee_id
    )
  );

-- Managers can create offers for shifts in their department
CREATE POLICY "Managers can create shift offers"
  ON shift_offers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      INNER JOIN shifts s ON s.id = shift_offers.shift_id
      WHERE up.id = auth.uid()
      AND up.role IN ('admin', 'manager')
      AND (
        up.can_access_all_departments = true
        OR s.department_id = up.department_id
      )
    )
  );

-- RLS Policies for notifications

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- System can create notifications (managers and admins)
CREATE POLICY "Managers can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role IN ('admin', 'manager')
    )
  );

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
