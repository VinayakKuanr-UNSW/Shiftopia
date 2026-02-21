-- Migration: Add unique index for apply_monthly_template ON CONFLICT clause
-- Date: 2026-02-20
-- Purpose: The `apply_monthly_template` RPC uses an `ON CONFLICT` clause on `(start_date, department_id, COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'))` to prevent duplicate roster creation. This commit adds the backing UNIQUE INDEX so that the Postgres constraint validation passes when publishing templates.

CREATE UNIQUE INDEX IF NOT EXISTS uk_rosters_date_dept_subdept 
ON rosters (
    start_date, 
    department_id, 
    COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000')
);
