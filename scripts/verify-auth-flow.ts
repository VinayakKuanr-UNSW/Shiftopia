
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Configure Env (if running with ts-node/node)
// But we might just hardcode for this temp script or let it pick up if configured
// Actually, since I'm creating a standalone script, I'll paste the keys to be sure it runs easily.


const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing Env Vars. Please run with dotenv or set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runVerification() {
    console.log('--- STARTING AUTH VERIFICATION ---');

    // 1. SIGN UP
    const randomId = Math.floor(Math.random() * 10000);
    const email = `agent_test_${randomId}@internal.dev`;
    const password = 'Password123!';

    console.log(`1. Attempting Sign Up for: ${email}`);

    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                first_name: 'Test',
                last_name: `User_${randomId}`,
            }
        }
    });

    if (authError) {
        console.error('❌ Sign Up Failed:', authError.message);
        return;
    }

    if (!authData.user) {
        console.error('❌ Sign Up returned no user (Check if email confirmation is required)');
        return;
    }

    console.log('✅ Sign Up Successful. User ID:', authData.user.id);
    const userId = authData.user.id;

    // 2. VERIFY PROFILE CREATION (Trigger Check)
    console.log('2. Verifying Profile Creation (Waiting 3s for trigger)...');
    await new Promise(r => setTimeout(r, 3000));

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (profileError) {
        console.error('❌ Profile Validation Failed:', profileError.message);
    } else {
        console.log('✅ Profile Created Successfully:', profile.email, `(Role: ${profile.role})`);
    }

    // 3. SIMULATE getUserProfile LOGIC
    console.log('3. Verifying getUserProfile Logic (Contracts & Certificates)');

    // Fetch Contracts
    const { data: contracts, error: contractsError } = await supabase
        .from('user_contracts')
        .select('*')
        .eq('user_id', userId);

    if (contractsError) console.error('Error fetching contracts:', contractsError.message);
    else console.log(`   Contracts found: ${contracts?.length} (Expected 0 for new user)`);

    // Fetch Certificates
    const { data: certs, error: certsError } = await supabase
        .from('app_access_certificates')
        .select('*')
        .eq('user_id', userId);

    if (certsError) console.error('Error fetching certificates:', certsError.message);
    else console.log(`   Certificates found: ${certs?.length} (Expected 0 for new user)`);

    // Calculate Highest Level (Logic from auth.service.ts)
    // For a new user with 0 certs => 'alpha' or 'member'
    const levels = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    let highest = 'alpha';
    // Logic simulation skipped since list is empty, but we confirm the query works.

    console.log('--- VERIFICATION COMPLETE ---');
}

runVerification();
