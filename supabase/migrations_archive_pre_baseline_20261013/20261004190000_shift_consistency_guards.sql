-- Migration: 20261004190000_shift_consistency_guards.sql
-- Description: Three invariants on `shifts` that the database did not hold,
--              found by auditing every shift and every writer (2026-10-04).
--
-- 1. PLACEMENT. A shift sits in its team's roster FOR ITS DATE, under a
--    sub-group of THAT roster, and its denormalised labels (group_type,
--    sub_group_name, shift_group_id) are that sub-group's.
--
--    Nothing held this, and the writers disagree about it:
--      * sm_move_shift (Group and People mode drags) changes shift_date but never
--        roster_id, and writes roster_subgroup_id = p_roster_subgroup_id
--        unconditionally — so a People-mode cross-day drag (date only) nulls the
--        NOT NULL sub-group and FAILS, and a Group-mode one leaves the shift in
--        yesterday's roster under tomorrow's sub-group. The client comment at the
--        call site describes the never-applied resolver version.
--      * the gateway's `edit` and sm_update_shift change shift_date without
--        roster_id, and the group/sub-group columns independently.
--      * shift_group_id was NULL on 19 of 20 rows and pointed at a group in
--        ANOTHER roster on the 20th.
--    The planner buckets on (group_type, sub_group_name), so a drifted label is a
--    shift drawn in the wrong row, or none — how 39 Office shifts once vanished.
--
--    Enforced by RESOLVING rather than refusing, so every writer — present and
--    future — is correct without being patched:
--      a. Roster = the team's roster covering shift_date (rosters are one per
--         team per day: uk_rosters_date_dept_subdept). No roster that day is a
--         refusal, never an invented roster (rostering periods are deliberate).
--      b. Sub-group = the one explicitly chosen, when it is on that roster;
--         otherwise the SAME group and sub-group name on that roster, created if
--         the day does not have it yet — which is what moving a shift to another
--         day means.
--      c. group_type / sub_group_name / shift_group_id are taken FROM the final
--         sub-group. The structural link is the truth; the labels follow it.
--    The shift's organisation must be the roster's (filled from it when absent).
--
-- 2. ASSIGNEE ⇔ STATUS. assigned_employee_id is set exactly when
--    assignment_status = 'assigned'. compute_shift_fields already derives the
--    status when the assignee changes; this CHECK is the backstop for a writer
--    that sets the status on its own.
--
-- 3. NO OVERLAP. One person never holds two live shifts whose times overlap.
--    Checked at COMMIT (a deferred constraint trigger), so a swap — which moves
--    two people across two shifts in two statements and is briefly "both" — is
--    judged on where it ends up, not on the step in between.
--
-- Data audited first: 20/20 shifts already satisfy all three.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Placement
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_shift_placement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_roster   public.rosters%ROWTYPE;
    v_sub      record;
    v_group_id uuid;
    v_name     text;
    v_keep     boolean;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.shift_date         IS NOT DISTINCT FROM NEW.shift_date
       AND OLD.roster_id          IS NOT DISTINCT FROM NEW.roster_id
       AND OLD.roster_subgroup_id IS NOT DISTINCT FROM NEW.roster_subgroup_id
       AND OLD.group_type         IS NOT DISTINCT FROM NEW.group_type
       AND OLD.sub_group_name     IS NOT DISTINCT FROM NEW.sub_group_name
       AND OLD.organization_id    IS NOT DISTINCT FROM NEW.organization_id
       AND OLD.department_id      IS NOT DISTINCT FROM NEW.department_id
       AND OLD.sub_department_id  IS NOT DISTINCT FROM NEW.sub_department_id THEN
        RETURN NEW;
    END IF;

    -- a. The roster covering the shift's date, for its team.
    SELECT * INTO v_roster FROM public.rosters WHERE id = NEW.roster_id;
    IF NOT FOUND
       OR NEW.shift_date NOT BETWEEN v_roster.start_date AND v_roster.end_date
       OR v_roster.department_id IS DISTINCT FROM NEW.department_id
       OR v_roster.sub_department_id IS DISTINCT FROM NEW.sub_department_id THEN
        SELECT * INTO v_roster FROM public.rosters r
         WHERE r.department_id = NEW.department_id
           AND r.sub_department_id IS NOT DISTINCT FROM NEW.sub_department_id
           AND NEW.shift_date BETWEEN r.start_date AND r.end_date
         ORDER BY r.start_date DESC
         LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'There is no roster on % for this team, so the shift cannot be placed there. Create the roster for that day first.',
                to_char(NEW.shift_date, 'Dy FMDD Mon YYYY')
                USING ERRCODE = 'check_violation', HINT = 'NO_ROSTER_FOR_DATE';
        END IF;
        NEW.roster_id := v_roster.id;
    END IF;

    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := v_roster.organization_id;
    ELSIF NEW.organization_id IS DISTINCT FROM v_roster.organization_id THEN
        RAISE EXCEPTION 'The shift''s organisation does not match its roster''s.'
            USING ERRCODE = 'check_violation', HINT = 'ROSTER_SCOPE_MISMATCH';
    END IF;

    -- b. The sub-group: the one chosen, if it is on this roster; else the same
    --    group + sub-group name on this roster.
    SELECT rs.id, rs.name, rg.id AS group_id, rg.external_id, rg.roster_id
      INTO v_sub
      FROM public.roster_subgroups rs
      JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
     WHERE rs.id = NEW.roster_subgroup_id;

    v_keep := FOUND AND v_sub.roster_id = NEW.roster_id
              AND (TG_OP = 'INSERT'
                   OR NEW.roster_subgroup_id IS DISTINCT FROM OLD.roster_subgroup_id
                   OR (v_sub.external_id = NEW.group_type::text AND v_sub.name = NEW.sub_group_name));

    IF NOT v_keep THEN
        IF NEW.group_type IS NULL THEN
            IF v_sub.external_id IS NULL THEN
                RAISE EXCEPTION 'A shift needs a group.'
                    USING ERRCODE = 'check_violation', HINT = 'NO_GROUP';
            END IF;
            NEW.group_type := v_sub.external_id::public.template_group_type;
        END IF;
        v_name := COALESCE(NULLIF(btrim(NEW.sub_group_name), ''), v_sub.name);
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'A shift needs a sub-group.'
                USING ERRCODE = 'check_violation', HINT = 'NO_SUBGROUP';
        END IF;

        SELECT rg.id INTO v_group_id
          FROM public.roster_groups rg
         WHERE rg.roster_id = NEW.roster_id AND rg.external_id = NEW.group_type::text;
        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'The roster for % has no % group.',
                to_char(NEW.shift_date, 'Dy FMDD Mon YYYY'), NEW.group_type
                USING ERRCODE = 'check_violation', HINT = 'NO_GROUP';
        END IF;

        SELECT rs.id INTO NEW.roster_subgroup_id
          FROM public.roster_subgroups rs
         WHERE rs.roster_group_id = v_group_id
           AND (lower(rs.name) = lower(v_name) OR lower(rs.name) = lower(replace(v_name, '_', ' ')))
         ORDER BY rs.sort_order NULLS LAST, rs.created_at
         LIMIT 1;
        IF NEW.roster_subgroup_id IS NULL THEN
            INSERT INTO public.roster_subgroups (roster_group_id, name, sort_order, required_headcount, min_headcount)
            VALUES (v_group_id, v_name, 999, 0, 0)
            RETURNING id INTO NEW.roster_subgroup_id;
        END IF;
    END IF;

    -- c. The labels are the sub-group's.
    SELECT rs.name, rg.id AS group_id, rg.external_id
      INTO v_sub
      FROM public.roster_subgroups rs
      JOIN public.roster_groups rg ON rg.id = rs.roster_group_id
     WHERE rs.id = NEW.roster_subgroup_id;
    NEW.group_type     := v_sub.external_id::public.template_group_type;
    NEW.sub_group_name := v_sub.name;
    NEW.shift_group_id := v_sub.group_id;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_placement ON public.shifts;
CREATE TRIGGER trg_shift_placement
    BEFORE INSERT OR UPDATE OF shift_date, roster_id, roster_subgroup_id, group_type, sub_group_name,
                               organization_id, department_id, sub_department_id
    ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_placement();

REVOKE ALL ON FUNCTION public.fn_shift_placement() FROM PUBLIC, anon, authenticated;

-- Labels for existing rows (shift_group_id was NULL on 19 of 20): a no-op touch
-- that lets the trigger fill them. Placement itself was already correct.
UPDATE public.shifts s
   SET shift_group_id = rs.roster_group_id
  FROM public.roster_subgroups rs
 WHERE rs.id = s.roster_subgroup_id
   AND s.shift_group_id IS DISTINCT FROM rs.roster_group_id;

ALTER TABLE public.shifts ALTER COLUMN organization_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Assignee ⇔ status
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shifts
    ADD CONSTRAINT shifts_assignee_matches_status
    CHECK ((assigned_employee_id IS NULL) = (assignment_status = 'unassigned'::public.shift_assignment_status));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. No overlapping shifts for one person (checked at commit)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_shift_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cur   public.shifts%ROWTYPE;
    v_other record;
    v_name  text;
BEGIN
    -- Deferred: judge the row as it stands at commit, not as it was written.
    SELECT * INTO v_cur FROM public.shifts WHERE id = NEW.id;
    IF NOT FOUND OR v_cur.assigned_employee_id IS NULL OR COALESCE(v_cur.is_cancelled, false)
       OR v_cur.start_at IS NULL OR v_cur.end_at IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT o.shift_date, o.start_time, o.end_time INTO v_other
      FROM public.shifts o
     WHERE o.assigned_employee_id = v_cur.assigned_employee_id
       AND o.id <> v_cur.id
       AND NOT COALESCE(o.is_cancelled, false)
       AND o.shift_date BETWEEN v_cur.shift_date - 1 AND v_cur.shift_date + 1
       AND tstzrange(o.start_at, o.end_at, '[)') && tstzrange(v_cur.start_at, v_cur.end_at, '[)')
     LIMIT 1;

    IF FOUND THEN
        SELECT NULLIF(trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
          INTO v_name FROM public.profiles WHERE id = v_cur.assigned_employee_id;
        RAISE EXCEPTION '% already has a shift that overlaps this one (% %–%). One person cannot work two shifts at once.',
            COALESCE(v_name, 'This employee'),
            to_char(v_other.shift_date, 'Dy FMDD Mon'),
            to_char(v_other.start_time, 'HH24:MI'),
            to_char(v_other.end_time, 'HH24:MI')
            USING ERRCODE = 'check_violation', HINT = 'SHIFT_OVERLAP';
    END IF;
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_no_overlap ON public.shifts;
CREATE CONSTRAINT TRIGGER trg_shift_no_overlap
    AFTER INSERT OR UPDATE OF assigned_employee_id, shift_date, start_time, end_time, is_cancelled
    ON public.shifts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.fn_shift_no_overlap();

REVOKE ALL ON FUNCTION public.fn_shift_no_overlap() FROM PUBLIC, anon, authenticated;
