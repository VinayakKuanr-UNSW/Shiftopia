
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    const id = '00000000-0000-0000-0000-0000000000a2';
    console.log(`Fixing row ${id}...`);

    // 1. Check current state
    const { data: before } = await supabase.rpc('debug_exec_sql', {
        sql: `SELECT id, lifecycle_status, assignment_status, assignment_outcome, assigned_employee_id FROM shifts WHERE id = '${id}'`
    });
    console.log('Before:', before?.[0]);

    // 2. Attempt Update
    const { data: updateRes, error } = await supabase.rpc('debug_exec_sql', {
        sql: `
          UPDATE shifts 
          SET assignment_outcome = NULL, 
              assignment_status = 'unassigned', 
              bidding_status = 'not_on_bidding',
              trading_status = 'NoTrade',
              assigned_employee_id = NULL
          WHERE id = '${id}'
        `
    });

    if (error) {
        console.error('Update Error:', error);
    } else {
        console.log('Update Result:', updateRes);
    }

    // 3. Check after state
    const { data: after } = await supabase.rpc('debug_exec_sql', {
        sql: `SELECT id, lifecycle_status, assignment_status, assignment_outcome, assigned_employee_id FROM shifts WHERE id = '${id}'`
    });
    console.log('After:', after?.[0]);
}

run().catch(console.error);
