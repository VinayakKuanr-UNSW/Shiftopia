
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Checking dependencies for shifts.lifecycle_status...');

    const sql = `
        SELECT 
            classid::regclass AS dependent_type,
            objid::regclass AS dependent_object,
            objsubid AS dependent_column
        FROM pg_depend 
        WHERE refobjid = 'public.shifts'::regclass
            AND refobjsubid = (
                SELECT ordinal_position 
                FROM information_schema.columns 
                WHERE table_name = 'shifts' AND column_name = 'lifecycle_status'
            )
    `;

    // Using a simpler query that doesn't rely on ordinal_position if pg_depend stores column number differently (it uses attnum)
    // Correct way:
    const sql2 = `
        SELECT 
            d.classid::regclass AS type,
            d.objid::regclass AS object
        FROM pg_depend d
        JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE d.refobjid = 'public.shifts'::regclass
        AND a.attname = 'lifecycle_status'
        AND d.deptype = 'n' -- normal dependency
    `;

    const { data, error } = await supabase.rpc('debug_exec_sql', { sql: sql2 });
    if (error) console.error(error);
    console.log('Dependencies:', data);
}

run().catch(console.error);
