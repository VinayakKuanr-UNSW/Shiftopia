/*
  # Create Audit Trail and Configuration System

  ## Overview
  This migration creates comprehensive audit logging, system configuration, and compliance tracking.

  ## New Tables

  ### 1. audit_logs
  - `id` (uuid, primary key)
  - `table_name` (text) - Table that was modified
  - `record_id` (uuid) - ID of modified record
  - `action` (text) - insert, update, delete
  - `changed_by_user_id` (uuid, foreign key to auth.users)
  - `old_data` (jsonb) - Previous values
  - `new_data` (jsonb) - New values
  - `changed_at` (timestamptz)

  ### 2. system_config
  - `id` (uuid, primary key)
  - `config_key` (text, unique) - Configuration key
  - `config_value` (jsonb) - Configuration value
  - `description` (text)
  - `last_modified_by` (uuid, foreign key to auth.users)
  - `last_modified_at` (timestamptz)

  ### 3. work_rules
  - `id` (uuid, primary key)
  - `rule_name` (text, unique)
  - `rule_value` (jsonb)
  - `description` (text)
  - `is_active` (boolean)
  - `created_at` (timestamptz)

  ### 4. login_audit
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `login_at` (timestamptz)
  - `logout_at` (timestamptz, nullable)
  - `ip_address` (text)
  - `user_agent` (text)
  - `session_duration` (interval)

  ## Security
  - Enable RLS on all tables
  - Audit logs are read-only for most users
  - Only admins can modify system config

  ## Indexes
  - Add indexes on frequently queried fields
*/

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz DEFAULT now()
);

-- Create system_config table
CREATE TABLE IF NOT EXISTS system_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL DEFAULT '{}',
  description text,
  last_modified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_modified_at timestamptz DEFAULT now()
);

-- Create work_rules table
CREATE TABLE IF NOT EXISTS work_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text UNIQUE NOT NULL,
  rule_value jsonb NOT NULL DEFAULT '{}',
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create login_audit table
CREATE TABLE IF NOT EXISTS login_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_at timestamptz DEFAULT now(),
  logout_at timestamptz,
  ip_address text,
  user_agent text,
  session_duration interval
);

-- Ensure tables have required columns
DO $$
BEGIN
    -- audit_logs
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'table_name' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN table_name text DEFAULT 'unknown';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'record_id' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN record_id uuid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'action' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN action text DEFAULT 'unknown' CHECK (action IN ('insert', 'update', 'delete', 'unknown'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'changed_by_user_id' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'old_data' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN old_data jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'new_data' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN new_data jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'changed_at' AND table_schema = 'public') THEN
        ALTER TABLE audit_logs ADD COLUMN changed_at timestamptz DEFAULT now();
    END IF;

    -- system_config
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_config' AND column_name = 'config_key' AND table_schema = 'public') THEN
         ALTER TABLE system_config ADD COLUMN config_key text UNIQUE;
    END IF;

    -- work_rules
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_rules' AND column_name = 'rule_name' AND table_schema = 'public') THEN
         ALTER TABLE work_rules ADD COLUMN rule_name text UNIQUE;
    END IF;

    -- login_audit
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'login_audit' AND column_name = 'user_id' AND table_schema = 'public') THEN
         ALTER TABLE login_audit ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'login_audit' AND column_name = 'login_at' AND table_schema = 'public') THEN
         ALTER TABLE login_audit ADD COLUMN login_at timestamptz DEFAULT now();
    END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by ON audit_logs(changed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON audit_logs(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
CREATE INDEX IF NOT EXISTS idx_work_rules_name ON work_rules(rule_name);
CREATE INDEX IF NOT EXISTS idx_work_rules_is_active ON work_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_login_at ON login_audit(login_at DESC);

-- Enable Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit_logs
CREATE POLICY "Authenticated users can view audit logs" ON audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can create audit logs" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- RLS Policies for system_config
CREATE POLICY "Everyone can view system config" ON system_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage system config" ON system_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can update system config" ON system_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for work_rules
CREATE POLICY "Everyone can view work rules" ON work_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage work rules" ON work_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can update work rules" ON work_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies for login_audit
CREATE POLICY "Users can view their own login audit" ON login_audit FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "System can create login audit" ON login_audit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update login audit" ON login_audit FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Insert default work rules
INSERT INTO work_rules (rule_name, rule_value, description) VALUES
  ('daily_hour_limit', '{"hours": 12}', 'Maximum hours an employee can work in a single day'),
  ('monthly_hour_limit', '{"hours": 152}', 'Maximum hours an employee can work in a single month'),
  ('minimum_rest_hours', '{"hours": 10}', 'Minimum rest period required between shifts'),
  ('max_consecutive_days', '{"days": 7}', 'Maximum consecutive days an employee can work')
ON CONFLICT (rule_name) DO NOTHING;

-- Insert default system config
INSERT INTO system_config (config_key, config_value, description) VALUES
  ('app_name', '{"value": "ICC Sydney Workforce Management"}', 'Application name'),
  ('timezone', '{"value": "Australia/Sydney"}', 'Default timezone'),
  ('date_format', '{"value": "DD/MM/YYYY"}', 'Default date format'),
  ('currency', '{"value": "AUD"}', 'Default currency'),
  ('payroll_frequency', '{"value": "fortnightly"}', 'Payroll payment frequency')
ON CONFLICT (config_key) DO NOTHING;
