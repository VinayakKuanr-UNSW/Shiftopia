
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) console.error('SQL Error:', error.message);
    return data;
}

async function run() {
    console.log('--- DIAGNOSTIC: List Tables ---');
    const res = await execSql(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
    `);
    console.log(JSON.stringify(res, null, 2));

    console.log('--- DIAGNOSTIC: Check Employees Explicitly ---');
    const res2 = await execSql(`
        SELECT count(*) FROM public.employees
    `);
    console.log('Employees Check:', JSON.stringify(res2));
}

run().catch(console.error);
