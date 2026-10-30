-- ============================================================================
-- One enforcement point for the EBA engine: a deferred trigger on shifts
--
-- WHY
--   Until now only the gateway (_apply_shift_op_write) asked
--   eba_check_assignment before writing. Every other way a person lands on a
--   shift wrote straight past it: the autoscheduler's commit
--   (sm_bulk_assign_atomic), emergency assign, trade acceptance, planning
--   finalisation, sm_create_shift with an assignee, bulk publish and template
--   apply. A rule enforced on one door of seven is advice.
--
--   The table is the only thing they all share, so the check moves there.
--   The gateway keeps its own pre-check: it returns a structured
--   EBA_COMPLIANCE_BREACH the UI explains, where this raises.
--
-- DEFERRED, like trg_shift_no_overlap
--   A swap writes two rows in two statements (sm_finalize_planning_request
--   moves A's shift to B, then B's to A). Checked per statement, the half-way
--   state can put B on two shifts at once and refuse a swap that is fine when
--   finished. At commit the trigger reads each row as it finally stands.
--
-- WHAT RE-CHECKS
--   Anything the engine reads about the shift (who, when, the break, the job,
--   the contract, training, the qualifications it asks for), a shift being
--   published — the agreement may have moved since a draft was checked a week
--   ago: new leave, an expired licence, a visa condition — and a cancelled or
--   deleted shift coming back. Only BLOCKING findings refuse.
--
-- CONCURRENCY
--   The same per-employee advisory lock the gateway takes, so two commits
--   placing one person cannot each pass on a snapshot missing the other.
-- ============================================================================

CREATE OR REPLACE FUNCTION internal.trg_shift_eba_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cur  public.shifts%ROWTYPE;
    v_key  text;
    v_done text;
    v_hit  record;
    v_name text;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.assigned_employee_id     IS NOT DISTINCT FROM OLD.assigned_employee_id
       AND NEW.shift_date               IS NOT DISTINCT FROM OLD.shift_date
       AND NEW.start_time               IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time                 IS NOT DISTINCT FROM OLD.end_time
       AND NEW.break_start              IS NOT DISTINCT FROM OLD.break_start
       AND NEW.break_end                IS NOT DISTINCT FROM OLD.break_end
       AND NEW.unpaid_break_minutes     IS NOT DISTINCT FROM OLD.unpaid_break_minutes
       AND NEW.role_id                  IS NOT DISTINCT FROM OLD.role_id
       AND NEW.sub_department_id        IS NOT DISTINCT FROM OLD.sub_department_id
       AND NEW.target_employment_type   IS NOT DISTINCT FROM OLD.target_employment_type
       AND NEW.target_requires_flexible IS NOT DISTINCT FROM OLD.target_requires_flexible
       AND NEW.is_training              IS NOT DISTINCT FROM OLD.is_training
       AND NEW.user_contract_id         IS NOT DISTINCT FROM OLD.user_contract_id
       AND NEW.required_skills          IS NOT DISTINCT FROM OLD.required_skills
       AND NEW.required_licenses        IS NOT DISTINCT FROM OLD.required_licenses
       AND NOT (NEW.lifecycle_status = 'Published' AND OLD.lifecycle_status IS DISTINCT FROM 'Published')
       AND NOT (COALESCE(OLD.is_cancelled, false) AND NOT COALESCE(NEW.is_cancelled, false))
       AND NOT (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
    THEN
        RETURN NULL;
    END IF;

    -- At commit: the row as it finally stands, not as this event saw it.
    SELECT * INTO v_cur FROM public.shifts s WHERE s.id = NEW.id;
    IF NOT FOUND
       OR v_cur.assigned_employee_id IS NULL
       OR COALESCE(v_cur.is_cancelled, false)
       OR v_cur.deleted_at IS NOT NULL
       OR v_cur.lifecycle_status = 'Cancelled' THEN
        RETURN NULL;
    END IF;

    -- A shift written several times in one transaction is checked once per
    -- final version (trg_increment_shift_version bumps it on every UPDATE).
    v_key  := v_cur.id::text || ':' || v_cur.version::text;
    v_done := COALESCE(current_setting('eba.checked', true), '');
    IF strpos(v_done, v_key) > 0 THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('eba.checked', v_done || ',' || v_key, true);

    PERFORM pg_advisory_xact_lock(hashtext('emp_assign:' || v_cur.assigned_employee_id::text));

    SELECT r.rule_id, r.details INTO v_hit
      FROM internal.eba_check_assignment(v_cur.id, v_cur.assigned_employee_id) r
     WHERE r.tier = 'BLOCKING'
     LIMIT 1;

    IF FOUND THEN
        SELECT NULLIF(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
          INTO v_name FROM public.profiles p WHERE p.id = v_cur.assigned_employee_id;
        RAISE EXCEPTION '% cannot work the shift on % (%–%): %',
            COALESCE(v_name, 'This employee'),
            to_char(v_cur.shift_date, 'Dy FMDD Mon'),
            to_char(v_cur.start_time, 'HH24:MI'),
            to_char(v_cur.end_time, 'HH24:MI'),
            v_hit.details
            USING ERRCODE = 'check_violation', HINT = 'EBA_COMPLIANCE:' || v_hit.rule_id;
    END IF;

    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION internal.trg_shift_eba_compliance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shift_eba_compliance ON public.shifts;
CREATE CONSTRAINT TRIGGER trg_shift_eba_compliance
AFTER INSERT OR UPDATE OF
    assigned_employee_id, shift_date, start_time, end_time, break_start, break_end,
    unpaid_break_minutes, role_id, sub_department_id, target_employment_type,
    target_requires_flexible, is_training, user_contract_id, required_skills,
    required_licenses, lifecycle_status, is_cancelled, deleted_at
ON public.shifts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION internal.trg_shift_eba_compliance();
