
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking specific columns...');
    const cols = [
        'employee_id',
        'is_trade_requested',
        'assignment_status_text',
        'assignment_method_text',
        'cancellation_type_text',
        'compliance_status_text'
    ];

    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'shifts' AND column_name IN ('${cols.join("','")}')`
    });
    console.log('Found Columns:', data);
}

run().catch(console.error);
