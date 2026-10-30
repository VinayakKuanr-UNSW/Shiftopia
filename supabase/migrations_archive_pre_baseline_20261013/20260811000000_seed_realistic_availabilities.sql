-- Seed realistic availability rules for employees
-- 15 employees (test1..test15) have flexible realistic availabilities matching early morning (05:30), daytime (06:00), and 24/7 shifts
-- Remaining ~92 employees have restricted non-matching availability rules so they are correctly flagged as "outside declared availability".

CREATE OR REPLACE FUNCTION public.generate_availability_slots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_date_cursor date;
  end_date_limit date;
  weekday int;
  days_diff int;
begin
  current_date_cursor := coalesce(new.start_date, current_date);

  if new.repeat_type = 'none' then
    end_date_limit := current_date_cursor;
  else
    end_date_limit := least(
      coalesce(new.repeat_end_date, '2099-01-01'),
      current_date_cursor + interval '180 days'
    );
  end if;

  while current_date_cursor <= end_date_limit loop
    weekday := extract(isodow from current_date_cursor);
    days_diff := (current_date_cursor - new.start_date);

    if
      new.repeat_type = 'none'
      or new.repeat_type = 'daily'
      or (
        new.repeat_type = 'weekly'
        and weekday = any(new.repeat_days)
      )
      or (
        new.repeat_type = 'fortnightly'
        and weekday = any(new.repeat_days)
        and (
          (days_diff / 7)::int % 2 = 0
        )
      )
    then
      insert into availability_slots (
        rule_id,
        profile_id,
        slot_date,
        start_time,
        end_time
      )
      values (
        new.id,
        new.profile_id,
        current_date_cursor,
        new.start_time,
        new.end_time
      )
      on conflict do nothing;
    end if;

    if new.repeat_type = 'none' then
      exit;
    end if;

    current_date_cursor := current_date_cursor + interval '1 day';
  end loop;

  return new;
end;
$function$;

BEGIN;

DELETE FROM public.availability_rules;

-- Available Group 1: test1 - test5 (Early Morning Crew 05:30 - 17:30 Mon-Sun)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '05:30:00'::time, '17:30:00'::time, 'weekly', ARRAY[1,2,3,4,5,6,7]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email IN ('test1@test.com', 'test2@test.com', 'test3@test.com', 'test4@test.com', 'test5@test.com');

-- Available Group 2: test6 - test10 (Day / Evening Crew 06:00 - 22:00 Mon-Sun)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '06:00:00'::time, '22:00:00'::time, 'weekly', ARRAY[1,2,3,4,5,6,7]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email IN ('test6@test.com', 'test7@test.com', 'test8@test.com', 'test9@test.com', 'test10@test.com');

-- Available Group 3: test11 - test15 (24/7 Fully Available Staff 00:00 - 23:59 Mon-Sun)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '00:00:00'::time, '23:59:00'::time, 'weekly', ARRAY[1,2,3,4,5,6,7]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email IN ('test11@test.com', 'test12@test.com', 'test13@test.com', 'test14@test.com', 'test15@test.com');

-- Unavailable Group 4: Late Night Only Tue/Thu (19:00 - 23:00)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '19:00:00'::time, '23:00:00'::time, 'weekly', ARRAY[2,4]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email NOT IN ('test1@test.com', 'test2@test.com', 'test3@test.com', 'test4@test.com', 'test5@test.com',
                    'test6@test.com', 'test7@test.com', 'test8@test.com', 'test9@test.com', 'test10@test.com',
                    'test11@test.com', 'test12@test.com', 'test13@test.com', 'test14@test.com', 'test15@test.com')
  AND (id::text < '70000000-0000-0000-0000-000000000000');

-- Unavailable Group 5: Midday 2-Hour Wed Only (12:00 - 14:00)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '12:00:00'::time, '14:00:00'::time, 'weekly', ARRAY[3]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email NOT IN ('test1@test.com', 'test2@test.com', 'test3@test.com', 'test4@test.com', 'test5@test.com',
                    'test6@test.com', 'test7@test.com', 'test8@test.com', 'test9@test.com', 'test10@test.com',
                    'test11@test.com', 'test12@test.com', 'test13@test.com', 'test14@test.com', 'test15@test.com')
  AND (id::text >= '70000000-0000-0000-0000-000000000000' AND id::text < 'b0000000-0000-0000-0000-000000000000');

-- Unavailable Group 6: Weekend Late Night Only Sat/Sun (20:00 - 23:59)
INSERT INTO public.availability_rules (profile_id, start_date, start_time, end_time, repeat_type, repeat_days, repeat_end_date)
SELECT id, '2026-08-01'::date, '20:00:00'::time, '23:59:00'::time, 'weekly', ARRAY[6,7]::smallint[], '2027-01-31'::date
FROM public.profiles
WHERE email NOT IN ('test1@test.com', 'test2@test.com', 'test3@test.com', 'test4@test.com', 'test5@test.com',
                    'test6@test.com', 'test7@test.com', 'test8@test.com', 'test9@test.com', 'test10@test.com',
                    'test11@test.com', 'test12@test.com', 'test13@test.com', 'test14@test.com', 'test15@test.com')
  AND (id::text >= 'b0000000-0000-0000-0000-000000000000');

COMMIT;
