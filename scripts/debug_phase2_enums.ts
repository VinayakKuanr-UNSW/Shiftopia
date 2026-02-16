
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking bidding_status Enum...');
    const { data: bidData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'bidding_status'::regtype ORDER BY enumsortorder"
    });
    console.log('Bidding Values:', bidData);

    console.log('Checking assignment_outcome Enum...');
    const { data: outData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'assignment_outcome'::regtype ORDER BY enumsortorder"
    });
    console.log('Outcome Values:', outData);
}

run().catch(console.error);
