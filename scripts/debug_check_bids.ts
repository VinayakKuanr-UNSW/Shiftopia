
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Listing columns for shift_bids (if exists)...');

    // Check if table exists
    const { data: tables } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT table_name FROM information_schema.tables WHERE table_name = 'shift_bids'"
    });

    if (tables && tables.length > 0) {
        const { data: cols } = await supabase.rpc('debug_exec_sql', {
            sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'shift_bids'"
        });
        console.log('Columns:', cols);
    } else {
        console.log('Table shift_bids does not exist.');
    }
}

run().catch(console.error);
