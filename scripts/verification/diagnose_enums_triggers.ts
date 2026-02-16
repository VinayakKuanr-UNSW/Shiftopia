
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) console.error('SQL Error:', error.message);
    return data;
}

async function run() {
    console.log('--- DIAGNOSTIC: Enums & Triggers ---');

    // 1. Check Enum Values
    console.log('\n1. Enum: shift_fulfillment_status');
    const enums = await execSql(`
        SELECT enum_range(NULL::shift_fulfillment_status)
    `);
    console.log(JSON.stringify(enums, null, 2));

    // 2. Check Triggers
    console.log('\n2. Triggers on shifts');
    const triggers = await execSql(`
        SELECT trigger_name, event_manipulation, action_statement
        FROM information_schema.triggers
        WHERE event_object_table = 'shifts'
    `);
    console.log(JSON.stringify(triggers, null, 2));
}

run().catch(console.error);
