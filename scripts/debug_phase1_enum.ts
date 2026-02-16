
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking assignment_status column type...');
    const { data: colData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'assignment_status'"
    });
    console.log('Column Type:', colData);

    if (colData && colData[0]) {
        const udtName = colData[0].udt_name;
        console.log(`Checking enum values for ${udtName}...`);
        const { data: enumData } = await supabase.rpc('debug_exec_sql', {
            sql: `SELECT enumlabel FROM pg_enum WHERE enumtypid = '${udtName}'::regtype ORDER BY enumsortorder`
        });
        console.log('Enum Values:', enumData);
    }
}

run().catch(console.error);
