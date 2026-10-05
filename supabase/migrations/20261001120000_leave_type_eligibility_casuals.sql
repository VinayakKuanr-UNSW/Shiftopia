-- Casuals cannot take PAID leave they have no entitlement to (audit H1, 2026-10-01).
--
-- ICC EBA cl 12.5(b): the 25% casual loading is "full recompense" for paid
-- annual, personal/carer's and compassionate leave. cl 51.1, 52.1, 53.2, 55.1,
-- 57.1 and 58.2 each exclude casuals by name. A casual MAY take: FDV leave
-- (cl 46, paid), unpaid carer's (cl 45.6(c)), unpaid compassionate (cl 48.8),
-- community service (cl 54) and long service (cl 49, NSW LSL Act).
--
-- Nothing checked the leave type against the person: the request form offered
-- all 13 types to everyone and the API refused nothing. This BEFORE trigger
-- refuses a pending/approved request of a paid type for someone whose ACTIVE
-- contracts are ALL casual. A person with one permanent and one casual
-- contract accrues on the permanent one and is not refused. It has to be a
-- trigger, not only app code: employees can insert into leave_requests
-- directly through the API (RLS allows their own pending rows).
--
-- Withdrawing, rejecting or revoking (status → cancelled / rejected) is never
-- blocked: the check fires for pending and approved only.
--
-- NOT DONE HERE: 17 casual-only employees still hold stale annual (~159h) and
-- personal (~80h) balances (created 2026-07-10..08-07, never used). With this
-- trigger they can no longer be drawn on; removing them is a separate decision.

CREATE OR REPLACE FUNCTION public.enforce_leave_type_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hr'
AS $function$
DECLARE
  v_all_casual boolean;
BEGIN
  IF NEW.status NOT IN ('pending', 'approved') THEN
    RETURN NEW;
  END IF;

  IF NEW.leave_type NOT IN ('annual', 'personal', 'parental', 'supporting_carer',
                            'jury_duty', 'religious_cultural', 'gender_affirmation', 'unpaid') THEN
    RETURN NEW;
  END IF;

  SELECT bool_and(lower(coalesce(uc.employment_status::text, '')) LIKE '%casual%')
    INTO v_all_casual
  FROM hr.user_contracts uc
  WHERE uc.user_id = NEW.employee_id
    AND uc.status = 'Active';

  -- NULL = no active contract: nothing to judge by, so not refused here.
  IF coalesce(v_all_casual, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('%s leave is not available to casual Team Members (ICC EBA cl 12.5(b)).', NEW.leave_type),
      HINT    = 'Casuals may take FDV, unpaid carer''s, unpaid compassionate, community service or long service leave.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_leave_type_eligibility ON public.leave_requests;
CREATE TRIGGER trg_enforce_leave_type_eligibility
  BEFORE INSERT OR UPDATE OF status, leave_type ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_type_eligibility();

-- Trigger-only. Revoked last: CREATE OR REPLACE can re-grant.
REVOKE EXECUTE ON FUNCTION public.enforce_leave_type_eligibility() FROM PUBLIC, anon, authenticated;
