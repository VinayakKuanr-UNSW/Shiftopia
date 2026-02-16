
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


async function verifyFetch() {
    console.log('Logging in...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: 'agent_test_6885@internal.dev',
        password: 'Password123!'
    });

    if (authError) {
        console.error('Login Error:', authError.message);
        return;
    }
    console.log('Logged in as:', authData.user?.email);

    const employeeId = 'be8b6a39-6552-409d-8a5b-f00862273a9d'; // Kurry Admin ID

    // Test 1: Simple Fetch
    console.log('Test 1: Fetching licenses (no join)...');
    const t1 = Date.now();
    const { data: d1, error: e1 } = await supabase
        .from('employee_licenses')
        .select('*')
        .eq('employee_id', employeeId);

    console.log(`Test 1 finished in ${Date.now() - t1}ms`);
    if (e1) console.error('T1 Error:', e1);
    else console.log('T1 Success:', d1?.length);

    // Test 2: With Join
    console.log('Test 2: Fetching licenses (with join)...');
    const t2 = Date.now();
    const { data: d2, error: e2 } = await supabase
        .from('employee_licenses')
        .select(`
          *,
          license:licenses(id, name, description)
        `)
        .eq('employee_id', employeeId);

    console.log(`Test 2 finished in ${Date.now() - t2}ms`);
    if (e2) console.error('T2 Error:', e2);
    else console.log('T2 Success:', d2?.length);
}

verifyFetch();

