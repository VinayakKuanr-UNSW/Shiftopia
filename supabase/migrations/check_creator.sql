-- Check who the current user is when creating shifts
SELECT 
    s.id,
    s.created_by_user_id,
    s.created_at,
    p.full_name as creator_name
FROM shifts s
LEFT JOIN profiles p ON s.created_by_user_id = p.id
WHERE s.id = '92112aa3-625a-4a19-b7c0-79307c7bb63f';

-- If you want to set the creator for this existing shift:
-- UPDATE shifts 
-- SET created_by_user_id = (SELECT id FROM profiles WHERE full_name = 'Kurry Admin' LIMIT 1)
-- WHERE id = '92112aa3-625a-4a19-b7c0-79307c7bb63f';

-- Check current auth user when logged in
SELECT auth.uid(), auth.email();
