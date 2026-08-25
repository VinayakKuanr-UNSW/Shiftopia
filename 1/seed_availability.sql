-- Seed Full Availability for Test Users (test1 to test100 + Kurry Admin)
-- Target: Event Delivery -> Set-up (6fefad95-9cf9-468c-8724-424cc2f7b640)

DO $$
DECLARE
    r RECORD;
    v_sub_dept_id UUID := '6fefad95-9cf9-468c-8724-424cc2f7b640';
BEGIN
    -- Delete existing availability rules (and cascaded slots) for test users and Kurry Admin
    DELETE FROM public.availability_rules
    WHERE profile_id IN (
        SELECT id FROM public.profiles WHERE email LIKE 'test%@test.com' OR email = 'kurryosity@gmail.com'
    );

    FOR r IN (
        SELECT p.id, p.email
        FROM public.profiles p
        WHERE (p.email LIKE 'test%@test.com' OR p.email = 'kurryosity@gmail.com')
          -- Exclude pure Full-Time profiles who have no casual contracts
          AND NOT public.sm_all_active_contracts_ft_in(p.id, v_sub_dept_id)
        ORDER BY p.email
    ) LOOP
        INSERT INTO public.availability_rules (
            profile_id,
            sub_department_id,
            start_date,
            start_time,
            end_time,
            repeat_type,
            repeat_days,
            repeat_end_date
        ) VALUES (
            r.id,
            v_sub_dept_id,
            '2026-08-01',
            '00:00:00',
            '23:59:59',
            'weekly',
            ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[],
            '2027-03-01'
        );
    END LOOP;
END $$;

