
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking dependencies for shifts.employee_id...');

    // Using pg_depend + pg_attribute to find column dependencies
    const sql = `
        SELECT 
            d.classid::regclass AS type,
            d.objid::regclass AS object
        FROM pg_depend d
        JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE d.refobjid = 'public.shifts'::regclass
        AND a.attname = 'employee_id'
        AND d.deptype = 'n'
    `;

    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) console.error(error);
    console.log('Dependencies:', data);
}

run().catch(console.error);
