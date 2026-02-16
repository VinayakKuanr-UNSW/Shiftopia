/*
  Fix Infinite Recursion in user_profiles RLS Policies
  
  Problem:
  The existing policies on user_profiles reference user_profiles in their
  USING/WITH CHECK clauses, causing infinite recursion when Postgres tries
  to evaluate the policy.
  
  Solution:
  1. Drop all existing policies on user_profiles
  2. Create simple, non-recursive policies that allow authenticated users
     to access profiles without self-referential checks
  3. Use SECURITY DEFINER functions if role-based checks are needed
*/

-- Drop all existing policies on user_profiles (including ones we might have created)
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can create profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow profile creation" ON user_profiles;

-- Create simple non-recursive policies
-- Allow all authenticated users to view all profiles (for now, can be tightened later)
CREATE POLICY "Authenticated users can view profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to update their own profile only
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Allow inserts for service role or during signup (handled by trigger)
CREATE POLICY "Allow profile creation"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Also fix the departments policy that references user_profiles
DROP POLICY IF EXISTS "Users can view accessible departments" ON departments;
DROP POLICY IF EXISTS "Authenticated users can view all departments" ON departments;
CREATE POLICY "Authenticated users can view all departments"
  ON departments FOR SELECT
  TO authenticated
  USING (true);

-- Fix shifts policy
DROP POLICY IF EXISTS "Users can view accessible shifts" ON shifts;
DROP POLICY IF EXISTS "Authenticated users can view all shifts" ON shifts;
CREATE POLICY "Authenticated users can view all shifts"
  ON shifts FOR SELECT
  TO authenticated
  USING (true);
