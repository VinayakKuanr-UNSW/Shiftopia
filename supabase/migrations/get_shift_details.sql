-- Get the actual shift data for the shift we're viewing
SELECT 
    s.id,
    s.shift_date,
    s.start_time,
    s.end_time,
    s.assigned_employee_id,
    s.created_by,
    s.created_at,
    s.updated_at,
    s.is_published,
    s.is_cancelled,
    s.lifecycle_status,
    -- Role info
    r.name as role_name,
    -- Employee info (if assigned)
    p.full_name as assigned_employee_name,
    -- Creator info
    creator.email as creator_email,
    creator.raw_user_meta_data->>'full_name' as creator_name,
    -- Location info
    sd.name as sub_department_name,
    d.name as department_name,
    o.name as organization_name
FROM shifts s
LEFT JOIN roles r ON s.role_id = r.id
LEFT JOIN profiles p ON s.assigned_employee_id = p.id
LEFT JOIN auth.users creator ON s.created_by = creator.id
LEFT JOIN sub_departments sd ON s.sub_department_id = sd.id
LEFT JOIN departments d ON sd.department_id = d.id
LEFT JOIN organizations o ON d.organization_id = o.id
WHERE s.id = '92112aa3-625a-4a19-b7c0-79307c7bb63f'
LIMIT 1;
