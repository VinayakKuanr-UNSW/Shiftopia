-- Quick fix: Set yourself as admin for testing
-- Run this first before testing admin functions

-- Option 1: Set a specific user as admin
UPDATE profiles 
SET system_role = 'admin'
WHERE email = 'your-email@example.com';  -- Replace with your actual email

-- Option 2: Set first user as admin
UPDATE profiles 
SET system_role = 'admin'
WHERE id = (SELECT id FROM profiles LIMIT 1);

-- Verify admin status
SELECT id, full_name, email, system_role
FROM profiles 
WHERE system_role = 'admin';
