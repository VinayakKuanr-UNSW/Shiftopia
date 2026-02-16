
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking shift_bids status values...');
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT DISTINCT status FROM shift_bids"
    });
    console.log('Statuses:', data);
}

run().catch(console.error);
