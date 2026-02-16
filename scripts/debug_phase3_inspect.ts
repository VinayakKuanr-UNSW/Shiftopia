
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Listing shifts columns...');
    const { data } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'shifts' ORDER BY ordinal_position"
    });
    console.log('Columns:', data);

    console.log('Listing triggers...');
    const { data: trig } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.shifts'::regclass"
    });
    console.log('Triggers:', trig);
}

run().catch(console.error);
