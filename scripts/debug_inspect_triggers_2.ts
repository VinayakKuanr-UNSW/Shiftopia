
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Inspecting Triggers...');

    const triggers = [
        'shift_compute_trigger',
        'shifts_audit_trigger',
        'trg_cleanup_offers_on_unassign',
        'trg_validate_shift_state_invariants' // check if I re-enabled acts weird
    ];

    for (const tgname of triggers) {
        console.log(`\n=== ${tgname} ===`);
        const { data: trigData } = await supabase.rpc('debug_exec_sql', {
            sql: `SELECT pg_get_triggerdef(oid) as def FROM pg_trigger WHERE tgname = '${tgname}' AND tgrelid = 'public.shifts'::regclass`
        });
        const def = trigData?.[0]?.def;
        console.log('Def:', def);

        if (def) {
            const match = def.match(/EXECUTE FUNCTION ([\w_]+)\(/);
            if (match) {
                const funcName = match[1];
                console.log(`Function: ${funcName}`);
                const { data: funcData } = await supabase.rpc('debug_exec_sql', {
                    sql: `SELECT pg_get_functiondef('${funcName}'::regproc) as def`
                });
                console.log('Function Code:', funcData?.[0]?.def);
            }
        }
    }
}

run().catch(console.error);
