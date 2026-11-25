-- public_holidays: one calendar per jurisdiction.
--
-- Needed for the second organization, BCEC (AU-QLD), 2026-11-25. Until now every
-- row was AU-NSW, and two things assumed it:
--   1. UNIQUE (holiday_date) — a date could belong to only one jurisdiction, so
--      Queensland's Christmas Day would collide with New South Wales'. The
--      (holiday_date, jurisdiction) key stays and is the real identity.
--   2. internal.toil_absence_credit_minutes counted every holiday in the week, of
--      any jurisdiction. It now counts those of the jurisdictions where the person
--      holds a Full-Time or Part-Time contract that week (TOIL is for permanent
--      staff; toil_recompute_week only calls it with such a contract). Today
--      every organization is AU-NSW, so every result is unchanged.
-- The 'AU-NSW' column default goes too: a holiday must name its jurisdiction.
--
-- Not here (follow-up with the per-organization EBA work): fn_eba_estimate_shift_cost
-- still prices against 'AU-NSW', and the client's date-holidays calendar is NSW.

ALTER TABLE public.public_holidays DROP CONSTRAINT IF EXISTS public_holidays_holiday_date_key;
ALTER TABLE public.public_holidays ALTER COLUMN jurisdiction DROP DEFAULT;

CREATE OR REPLACE FUNCTION internal.toil_absence_credit_minutes(p_employee uuid, p_week_start date, p_daily_minutes integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_week_end   date := p_week_start + 6;
    v_leave      numeric := 0;
    v_ph         integer := 0;
    v_leave_days date[] := '{}';
    r            record;
    v_s          date;
    v_e          date;
    v_weekdays   integer;
    v_alldays    integer;
    v_in_week    integer;
BEGIN
    FOR r IN
        SELECT lr.start_date, lr.end_date, lr.requested_hours
          FROM public.leave_requests lr
         WHERE lr.employee_id = p_employee
           AND lr.status = 'approved'
           AND (lr.start_date AT TIME ZONE 'UTC')::date <= v_week_end
           AND (lr.end_date AT TIME ZONE 'UTC')::date >= p_week_start
    LOOP
        v_s := (r.start_date AT TIME ZONE 'UTC')::date;
        v_e := (r.end_date AT TIME ZONE 'UTC')::date;
        SELECT count(*) FILTER (WHERE extract(isodow FROM d) < 6), count(*)
          INTO v_weekdays, v_alldays
          FROM generate_series(v_s, v_e, interval '1 day') d;
        SELECT count(*) FILTER (WHERE v_weekdays = 0 OR extract(isodow FROM d) < 6)
          INTO v_in_week
          FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d;
        IF coalesce(v_alldays, 0) > 0 THEN
            v_leave := v_leave + coalesce(r.requested_hours, 0) * 60 * v_in_week
                       / CASE WHEN v_weekdays > 0 THEN v_weekdays ELSE v_alldays END;
        END IF;
        v_leave_days := v_leave_days || ARRAY(
            SELECT d::date FROM generate_series(greatest(v_s, p_week_start), least(v_e, v_week_end), interval '1 day') d);
    END LOOP;

    -- Holidays of the jurisdictions where this person holds a permanent contract
    -- in the week (a Brisbane holiday is not a day off for Sydney staff).
    SELECT count(DISTINCT ph.holiday_date) INTO v_ph
      FROM public.public_holidays ph
     WHERE ph.holiday_date BETWEEN p_week_start AND v_week_end
       AND extract(isodow FROM ph.holiday_date) < 6
       AND NOT (ph.holiday_date = ANY (v_leave_days))
       AND ph.jurisdiction IN (
            SELECT o.jurisdiction
              FROM hr.user_contracts uc
              JOIN public.organizations o ON o.id = uc.organization_id
             WHERE uc.user_id = p_employee
               AND uc.employment_status IN ('Full-Time', 'Part-Time', 'Flexible Part-Time')
               AND daterange(uc.start_date, uc.end_date, '[]') && daterange(p_week_start, v_week_end, '[]'));

    RETURN round(v_leave)::integer + v_ph * coalesce(p_daily_minutes, 0);
END;
$function$;
