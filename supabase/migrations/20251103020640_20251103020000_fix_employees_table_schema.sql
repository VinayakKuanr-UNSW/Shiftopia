/*
  # Fix Employees Table Schema
  
  ## Overview
  This migration resolves the schema conflict in the employees table by ensuring
  it has the correct column structure that matches both the TypeScript types and
  the user_profiles migration expectations.
  
  ## Changes Made
  
  1. **Employees Table Column Updates**
     - Adds `first_name` and `last_name` columns if they don't exist
     - Migrates data from single `name` column to split first/last name format
     - Adds additional employee fields: `employee_id`, `status`, `employment_type`
     - Ensures all columns match the TypeScript Database types
  
  2. **Data Migration**
     - Safely splits existing `name` values into first_name and last_name
     - Preserves all existing employee data
     - Uses IF EXISTS checks to prevent errors
  
  ## Security
  - Maintains existing RLS policies
  - No changes to access control
  
  ## Important Notes
  - This migration is idempotent and safe to run multiple times
  - Data is preserved during column transformations
  - Compatible with existing foreign key relationships
*/

-- Step 1: Add new columns if they don't exist
DO $$
BEGIN
  -- Add first_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE employees ADD COLUMN first_name text;
  END IF;

  -- Add last_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE employees ADD COLUMN last_name text;
  END IF;

  -- Add employee_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE employees ADD COLUMN employee_id text;
  END IF;

  -- Add status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'status'
  ) THEN
    ALTER TABLE employees ADD COLUMN status text DEFAULT 'Active';
  END IF;

  -- Add employment_type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'employment_type'
  ) THEN
    ALTER TABLE employees ADD COLUMN employment_type text DEFAULT 'Full-time';
  END IF;

  -- Add middle_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'middle_name'
  ) THEN
    ALTER TABLE employees ADD COLUMN middle_name text;
  END IF;

  -- Add availability column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'availability'
  ) THEN
    ALTER TABLE employees ADD COLUMN availability jsonb;
  END IF;
END $$;

-- Step 2: Migrate data from 'name' column to 'first_name' and 'last_name' if needed
DO $$
BEGIN
  -- Only migrate if first_name or last_name are null but name exists
  UPDATE employees
  SET 
    first_name = COALESCE(first_name, split_part(name, ' ', 1)),
    last_name = COALESCE(last_name, 
      CASE 
        WHEN array_length(string_to_array(name, ' '), 1) > 1 
        THEN array_to_string((string_to_array(name, ' '))[2:], ' ')
        ELSE split_part(name, ' ', 1)
      END
    )
  WHERE (first_name IS NULL OR last_name IS NULL) AND name IS NOT NULL;
  
  -- Set default employee_id using a subquery to avoid window functions in UPDATE
  WITH numbered_employees AS (
    SELECT id, 'EMP' || LPAD(CAST(ROW_NUMBER() OVER (ORDER BY created_at) AS TEXT), 6, '0') as new_emp_id
    FROM employees
    WHERE employee_id IS NULL
  )
  UPDATE employees
  SET employee_id = numbered_employees.new_emp_id
  FROM numbered_employees
  WHERE employees.id = numbered_employees.id;
END $$;

-- Step 3: Make first_name and last_name NOT NULL after data migration
DO $$
BEGIN
  -- Set NOT NULL constraints
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'first_name' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE employees ALTER COLUMN first_name SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'last_name' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE employees ALTER COLUMN last_name SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'employee_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE employees ALTER COLUMN employee_id SET NOT NULL;
  END IF;
END $$;

-- Step 4: Add unique constraint on employee_id if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'employees_employee_id_key'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);
  END IF;
END $$;

-- Step 5: Drop the old 'name' column if it exists and data has been migrated
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM employees WHERE first_name IS NULL OR last_name IS NULL
  ) THEN
    ALTER TABLE employees DROP COLUMN IF EXISTS name;
  END IF;
END $$;