
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Get shifts_select policy...');
    // pg_get_expr(polqual, polrelid) gives the WHERE clause
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT pg_get_expr(polqual, polrelid) as qual, pg_get_expr(polwithcheck, polrelid) as withcheck FROM pg_policy WHERE polname = 'shifts_select' AND polrelid = 'public.shifts'::regclass"
    });
    console.log('Policy Def:', data);
}

run().catch(console.error);
