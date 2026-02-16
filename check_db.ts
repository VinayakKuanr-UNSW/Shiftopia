
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

async function check() {
    console.log('Checking shift 3c717082-4ecb-4efe-ac71-e73e0e5cfbdc...');
    const { data: shift, error: shiftError } = await sb
        .from('shifts')
        .select('*')
        .eq('id', '3c717082-4ecb-4efe-ac71-e73e0e5cfbdc')
        .single();

    if (shiftError) console.error('Shift error:', shiftError);
    else console.log('Shift:', JSON.stringify(shift, null, 2));

    console.log('\nChecking profiles table columns...');
    const { data: profile, error: profileError } = await sb
        .from('profiles')
        .select('*')
        .limit(1);

    if (profileError) console.error('Profile error:', profileError);
    else if (profile && profile.length > 0) console.log('Profile keys:', Object.keys(profile[0]));
    else console.log('No profiles found');
}

check();
