
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Resolving Trigger OID 28863...');
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT tgname, tgenabled, tgrelid::regclass FROM pg_trigger WHERE oid = 28863"
    });
    console.log('Trigger:', data);
}

run().catch(console.error);
