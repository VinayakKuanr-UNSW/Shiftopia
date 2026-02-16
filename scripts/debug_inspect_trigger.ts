
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Inspecting Trigger shift_lifecycle_change_trigger and its Function...');

    // Get Trigger Def
    const { data: trigData } = await supabase.rpc('debug_exec_sql', {
        sql: `
         SELECT pg_get_triggerdef(oid) as def 
         FROM pg_trigger 
         WHERE tgname = 'shift_lifecycle_change_trigger' AND tgrelid = 'public.shifts'::regclass
       `
    });
    console.log('Trigger Def:', trigData?.[0]?.def);

    if (trigData && trigData[0]) {
        // Extract function name. Usually "EXECUTE FUNCTION func_name()"
        const match = trigData[0].def.match(/EXECUTE FUNCTION ([\w_]+)\(/);
        if (match) {
            const funcName = match[1];
            console.log(`Function Name: ${funcName}`);

            // Get Function Def
            const { data: funcData } = await supabase.rpc('debug_exec_sql', {
                sql: `SELECT pg_get_functiondef('${funcName}'::regproc) as def`
            });
            console.log('Function Def:', funcData?.[0]?.def);
        }
    }
}

run().catch(console.error);
