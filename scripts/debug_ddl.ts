
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Testing DDL execution...');
    const sql = "CREATE TYPE test_enum_debug AS ENUM ('A', 'B');";

    // Explicitly call debug_exec_sql and print result
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });

    console.log('Result:', data);
    console.log('Error:', error);

    // Verify
    const { data: ver, error: verErr } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'test_enum_debug'::regtype"
    });
    console.log('Verification:', ver);

    // Cleanup
    await supabase.rpc('debug_exec_sql', { sql: "DROP TYPE IF EXISTS test_enum_debug;" });
}

run().catch(console.error);
