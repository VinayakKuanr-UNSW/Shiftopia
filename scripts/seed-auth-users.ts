import { createClient } from '@supabase/supabase-js';

// 🔐 STEP 1: connect to Supabase using ADMIN power
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 🏢 our email domain
const DOMAIN = 'iccsydney.com';

// 🎭 roles distribution
const roles = [
  ...Array(5).fill('admin'),
  ...Array(15).fill('manager'),
  ...Array(30).fill('teamlead'),
  ...Array(50).fill('member'),
];

async function run() {
  console.log('👶 Starting user creation...');

  for (let i = 0; i < 100; i++) {
    const email = `staff${i + 1}@${DOMAIN}`;
    const password = 'Password@123';

    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        seed_role: roles[i],
      },
    });

    if (error) {
      console.error('❌ Failed:', email, error.message);
    } else {
      console.log('✅ Created:', email);
    }
  }

  console.log('🎉 Done creating users');
}

run();
