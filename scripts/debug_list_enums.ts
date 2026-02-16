
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Listing all Enums...');
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname"
    });
    console.log('Enums:', data);
}

run().catch(console.error);
