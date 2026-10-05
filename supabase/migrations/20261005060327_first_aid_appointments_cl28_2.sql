-- ─────────────────────────────────────────────────────────────────────────────
-- APPLIED TO PROD 2026-10-05 via the Supabase MCP (ledger version
-- 20261005060327, name first_aid_appointments_cl28_2). Do not re-run against
-- production. Verified beforehand by a rollback-only dry-run with 11 probes
-- (lookup, exclusion, range CHECK, manager/self/employee RLS, anon grants).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- cl 28.2 First Aid Allowance — model the appointment as a property of the
-- PERSON, not the shift.
--
-- EBA text (ICC Sydney EA 2025, cl 28.2):
--   "A Team Member holding a first aid qualification from St John Ambulance or
--    a similar body and who is appointed by the Employer to perform First Aid
--    duties must be paid for ordinary hours a First Aid Allowance as set out in
--    Schedule 2."   Sch 2 §3: $0.56 per hour.
--
-- The clause attaches the allowance to an appointed Team Member and pays it on
-- every ordinary hour they work. It says nothing about a shift. The previous
-- model (20260727225942, `shifts.is_first_aid_duty boolean`) read "on a shift"
-- into the clause, and in the ten weeks it existed nothing ever wrote it: no
-- form field, no RPC parameter, no trigger. Every allowance it was meant to
-- price was silently zero.
--
-- This migration:
--   1. adds `first_aid_appointments` — a time-bounded appointment per employee
--      per organisation (effective_to NULL = open-ended; a one-day range covers
--      an event-specific appointment);
--   2. drops the never-written column and replaces it with a COMPUTED attribute
--      of the same name, `is_first_aid_duty(shifts)`. PostgREST exposes it as a
--      selectable field and SQL can read it as `s.is_first_aid_duty`, so the
--      payroll read path keeps working unchanged. Because it is derived from
--      the assignee, a swap, bid win or reassignment can never carry the
--      allowance to someone who was not appointed.
--
-- Deliberately NOT gated on a current first-aid qualification. cl 28.2 does
-- require one, but the licence/skill records have never been audited (two
-- sources that disagree: 35 licence holders vs 46 skill holders). The pay
-- engine must never deny an entitlement on the strength of an unaudited HR
-- record; the UI warns at appointment time instead. Paying an appointee whose
-- certificate has lapsed is a $0.56/h over-payment — the safe direction.
--
-- Write access needs `contract.manage` over one of the employee's active
-- contracts, and nobody may appoint themselves (the record changes their pay).
-- Read access is any member of the organisation: WHS first-aid arrangements
-- require workers to know who the first aiders are, and the roster cost view
-- needs it for every shift the viewer can already see.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.first_aid_appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from  date NOT NULL,
  effective_to    date,
  appointed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT first_aid_appointments_valid_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  -- One live appointment per person per organisation per day. The GiST index
  -- this creates is also the lookup path for is_first_aid_duty() below.
  CONSTRAINT first_aid_appointments_no_overlap EXCLUDE USING gist (
    organization_id WITH =,
    employee_id     WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

COMMENT ON TABLE public.first_aid_appointments IS
  'cl 28.2 — an employee appointed by the Employer to perform First Aid duties. The allowance ($0.56/ordinary hour, Sch 2 §3) applies to every ordinary hour they work inside [effective_from, effective_to]; effective_to NULL = until revoked.';

CREATE TRIGGER first_aid_appointments_set_updated_at
  BEFORE UPDATE ON public.first_aid_appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

-- ── Authorisation ───────────────────────────────────────────────────────────
-- DEFINER so it can read the TARGET employee's contracts regardless of the
-- caller's visibility of them. It only answers "may the caller manage this
-- employee's appointment", never anything about the employee.
CREATE FUNCTION public.can_manage_first_aid_appointment(p_employee_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_employee_id IS DISTINCT FROM auth.uid()
     AND (
       public.user_has_action_in_scope('contract.manage', p_org_id, NULL, NULL)
       OR EXISTS (
         SELECT 1
         FROM public.user_contracts uc
         WHERE uc.user_id = p_employee_id
           AND uc.status = 'Active'
           AND uc.organization_id = p_org_id
           AND public.user_has_action_in_scope(
                 'contract.manage', uc.organization_id, uc.department_id, uc.sub_department_id)
       )
     );
$$;

ALTER TABLE public.first_aid_appointments ENABLE ROW LEVEL SECURITY;

-- Every outer column is qualified with the table name: an unqualified
-- `organization_id` inside the EXISTS would bind to uc.organization_id and
-- silently turn the org check into a tautology (see RLS correlated-subquery
-- bug class in memory).
CREATE POLICY first_aid_appointments_select ON public.first_aid_appointments
  FOR SELECT TO authenticated
  USING (
    first_aid_appointments.employee_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_contracts uc
      WHERE uc.user_id = (SELECT auth.uid())
        AND uc.status = 'Active'
        AND uc.organization_id = first_aid_appointments.organization_id
    )
    OR public.user_has_action_in_scope('contract.view', first_aid_appointments.organization_id, NULL, NULL)
  );

CREATE POLICY first_aid_appointments_insert ON public.first_aid_appointments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_first_aid_appointment(employee_id, organization_id));

CREATE POLICY first_aid_appointments_update ON public.first_aid_appointments
  FOR UPDATE TO authenticated
  USING      (public.can_manage_first_aid_appointment(employee_id, organization_id))
  WITH CHECK (public.can_manage_first_aid_appointment(employee_id, organization_id));

CREATE POLICY first_aid_appointments_delete ON public.first_aid_appointments
  FOR DELETE TO authenticated
  USING (public.can_manage_first_aid_appointment(employee_id, organization_id));

-- ── Replace the never-written column with a derived attribute ────────────────
-- Safe: 0 rows have ever held true, and no function, trigger, view or index
-- references the column (verified against pg_proc / pg_depend 2026-10-05).
ALTER TABLE public.shifts DROP COLUMN is_first_aid_duty;

-- INVOKER: reads first_aid_appointments under the caller's RLS. Anyone who can
-- see the shift is in its organisation and can therefore see the appointment.
CREATE FUNCTION public.is_first_aid_duty(s public.shifts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT s.assigned_employee_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.first_aid_appointments a
       WHERE a.organization_id = s.organization_id
         AND a.employee_id     = s.assigned_employee_id
         AND daterange(a.effective_from, a.effective_to, '[]') @> s.shift_date
     );
$$;

COMMENT ON FUNCTION public.is_first_aid_duty(public.shifts) IS
  'cl 28.2 — true when the shift''s assignee holds a first-aid appointment covering shift_date. Computed field: select it as `is_first_aid_duty` in PostgREST or read `s.is_first_aid_duty` in SQL.';

-- ── Grants (revoke LAST: CREATE re-applies default privileges) ──────────────
-- Supabase's default privileges grant to anon AND authenticated; PUBLIC and
-- anon are separate holes and both must be closed.
REVOKE ALL ON public.first_aid_appointments FROM anon;
REVOKE ALL ON FUNCTION public.can_manage_first_aid_appointment(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_first_aid_duty(public.shifts)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_first_aid_appointment(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_first_aid_duty(public.shifts)            TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
