
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Resolving... 18276 (Policy), 53712 (View/Rule)');

    // Policy
    const { data: polData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT polname, polrelid::regclass FROM pg_policy WHERE oid = 18276"
    });
    console.log('Policy:', polData);

    // View/Rule
    const { data: ruleData } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT rulename, ev_class::regclass FROM pg_rewrite WHERE oid = 53712"
    });
    console.log('Rule:', ruleData);
}

run().catch(console.error);
