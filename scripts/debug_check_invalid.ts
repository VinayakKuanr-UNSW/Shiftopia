
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Counting Invalid States...');
    const { data: countData, error } = await supabase.rpc('debug_exec_sql', {
        sql: "SELECT COUNT(*) FROM shifts_with_state WHERE state_id = 'INVALID'"
    });
    if (error) console.error(error);
    console.log('Invalid Count:', countData);

    if (countData && countData[0] && countData[0].count > 0) {
        console.log('Sample invalid shifts:');
        const { data: sampleData } = await supabase.rpc('debug_exec_sql', {
            sql: "SELECT id, lifecycle_status, assignment_status, assignment_outcome, bidding_status, trading_status FROM shifts_with_state WHERE state_id = 'INVALID' LIMIT 5"
        });
        console.log(JSON.stringify(sampleData, null, 2));
    } else {
        console.log('✅ No invalid states found.');
    }
}

run().catch(console.error);
