
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Get validate_shift_state_invariants...');
    const { data: funcData } = await supabase.rpc('debug_exec_sql', {
        sql: `SELECT pg_get_functiondef('validate_shift_state_invariants'::regproc) as def`
    });
    console.log('Function Code:', funcData?.[0]?.def);
}

run().catch(console.error);
