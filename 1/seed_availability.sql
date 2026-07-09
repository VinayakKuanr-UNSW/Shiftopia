-- Seed Availability for Test Users (test1 to test100)
--
-- This script clears existing availability rules for the test users and inserts a 
-- realistic mix of weekly recurring availability rules for each profile. 
--
-- Note: A database trigger (trg_generate_availability_slots) automatically runs 
-- after insertion into availability_rules to generate the daily slots for the 
-- next 180 days.

DO $$
DECLARE
    r RECORD;
    v_idx INT := 1;
    v_start_date DATE := CURRENT_DATE; -- Start from today
    v_repeat_days SMALLINT[];
    v_start_time TIME;
    v_end_time TIME;
BEGIN
    -- Delete existing availability rules (and cascaded slots) for test users
    DELETE FROM public.availability_rules
    WHERE profile_id IN (
        SELECT id FROM public.profiles WHERE email LIKE 'test%@test.com'
    );

    FOR r IN (
        SELECT id, email FROM public.profiles
        WHERE email LIKE 'test%@test.com'
        ORDER BY email
    ) LOOP
        -- Extract user index N from 'testN@test.com'
        v_idx := substring(r.email FROM 'test([0-9]+)@')::int;
        
        -- Partition the 100 test users into 5 representative groups:
        IF v_idx <= 20 THEN
            -- Group 1: Weekday availability (Mon-Fri) 09:00 - 17:00
            v_repeat_days := ARRAY[1, 2, 3, 4, 5]::SMALLINT[];
            v_start_time := '09:00:00';
            v_end_time := '17:00:00';
        ELSIF v_idx <= 40 THEN
            -- Group 2: Weekend availability (Sat-Sun) 08:00 - 22:00
            v_repeat_days := ARRAY[6, 7]::SMALLINT[];
            v_start_time := '08:00:00';
            v_end_time := '22:00:00';
        ELSIF v_idx <= 60 THEN
            -- Group 3: High availability (Mon-Sun) 07:00 - 23:00
            v_repeat_days := ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[];
            v_start_time := '07:00:00';
            v_end_time := '23:00:00';
        ELSIF v_idx <= 80 THEN
            -- Group 4: Mon, Wed, Fri availability 09:00 - 21:00
            v_repeat_days := ARRAY[1, 3, 5]::SMALLINT[];
            v_start_time := '09:00:00';
            v_end_time := '21:00:00';
        ELSE
            -- Group 5: Tue, Thu availability 08:00 - 18:00
            v_repeat_days := ARRAY[2, 4]::SMALLINT[];
            v_start_time := '08:00:00';
            v_end_time := '18:00:00';
        END IF;

        INSERT INTO public.availability_rules (
            profile_id,
            start_date,
            start_time,
            end_time,
            repeat_type,
            repeat_days,
            repeat_end_date
        ) VALUES (
            r.id,
            v_start_date,
            v_start_time,
            v_end_time,
            'weekly',
            v_repeat_days,
            v_start_date + INTERVAL '180 days'
        );
    END LOOP;
END $$;
