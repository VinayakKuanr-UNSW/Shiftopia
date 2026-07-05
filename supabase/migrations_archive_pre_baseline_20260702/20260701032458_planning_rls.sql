-- Migration: 20260702020000_planning_rls.sql
-- Description: Adds RLS policies to planning_requests, planning_offers, and bulk_assign_idempotency

-- 1. public.planning_requests
ALTER TABLE public.planning_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view relevant planning requests"
ON public.planning_requests
FOR SELECT
TO authenticated
USING (
    auth.uid() = initiated_by OR 
    auth.uid() = manager_id OR 
    auth.uid() = target_employee_id OR 
    public.is_manager_or_above()
);

CREATE POLICY "Users can create their own planning requests"
ON public.planning_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = initiated_by);

CREATE POLICY "Initiator or manager can update planning requests"
ON public.planning_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = initiated_by OR auth.uid() = manager_id);

CREATE POLICY "Initiator can delete their own planning requests"
ON public.planning_requests
FOR DELETE
TO authenticated
USING (auth.uid() = initiated_by);


-- 2. public.planning_offers
ALTER TABLE public.planning_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view relevant planning offers"
ON public.planning_offers
FOR SELECT
TO authenticated
USING (
    auth.uid() = offered_by OR 
    auth.uid() IN (SELECT initiated_by FROM public.planning_requests WHERE id = request_id) OR
    public.is_manager_or_above()
);

CREATE POLICY "Users can create their own planning offers"
ON public.planning_offers
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = offered_by);

CREATE POLICY "Users can update their own planning offers"
ON public.planning_offers
FOR UPDATE
TO authenticated
USING (auth.uid() = offered_by);

CREATE POLICY "Users can delete their own planning offers"
ON public.planning_offers
FOR DELETE
TO authenticated
USING (auth.uid() = offered_by);


-- 3. public.bulk_assign_idempotency
ALTER TABLE public.bulk_assign_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view bulk assign idempotency"
ON public.bulk_assign_idempotency
FOR SELECT
TO authenticated
USING (public.is_manager_or_above());

CREATE POLICY "Managers can insert bulk assign idempotency"
ON public.bulk_assign_idempotency
FOR INSERT
TO authenticated
WITH CHECK (public.is_manager_or_above());

CREATE POLICY "Managers can update bulk assign idempotency"
ON public.bulk_assign_idempotency
FOR UPDATE
TO authenticated
USING (public.is_manager_or_above());

CREATE POLICY "Managers can delete bulk assign idempotency"
ON public.bulk_assign_idempotency
FOR DELETE
TO authenticated
USING (public.is_manager_or_above());
