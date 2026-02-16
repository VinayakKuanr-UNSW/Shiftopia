
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Listing Enums...');
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: `
       SELECT t.typname, e.enumlabel 
       FROM pg_type t 
       JOIN pg_enum e ON t.oid = e.enumtypid 
       WHERE t.typname IN ('shift_lifecycle', 'shift_trading', 'assignment_status', 'assignment_outcome', 'bidding_status', 'attendance_status')
       ORDER BY t.typname, e.enumsortorder
       `
    });
    console.log('Enums:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
