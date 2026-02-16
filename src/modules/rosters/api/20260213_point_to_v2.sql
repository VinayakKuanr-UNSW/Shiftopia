-- Migration: Update apply_monthly_template to use v2
-- Date: 2026-02-13
-- Purpose: Point the main entry point RPC to the new V2 logic.

CREATE OR REPLACE FUNCTION apply_monthly_template(
    p_template_id uuid,
    p_organization_id uuid,
    p_month text -- 'YYYY-MM'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_start_date date;
    v_end_date date;
    v_user_id uuid;
BEGIN
    -- Calculate start/end of month
    v_start_date := (p_month || '-01')::date;
    v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;
    
    -- Get current user (for audit/created_by)
    v_user_id := auth.uid();
    
    -- Call the V2 function
    RETURN apply_template_to_date_range_v2(
        p_template_id,
        v_start_date,
        v_end_date,
        v_user_id
    );
END;
$$;
