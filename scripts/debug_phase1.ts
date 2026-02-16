
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking shift_lifecycle Enum...');
    const { data: enumData, error: enumError } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'shift_lifecycle'::regtype ORDER BY enumsortorder"
    });
    console.log('Enum Values:', enumData);

    console.log('Checking triggers on shifts...');
    const { data: trigData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.shifts'::regclass"
    });
    console.log('Triggers:', trigData);
}

run().catch(console.error);
