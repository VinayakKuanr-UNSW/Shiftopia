
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    console.log('Running 005a step-by-step...');

    const steps = [
        {
            name: "1. Fix Draft shifts",
            sql: `UPDATE shifts SET assignment_outcome = 'pending' WHERE lifecycle_status = 'Draft' AND assignment_status = 'assigned' AND assignment_outcome NOT IN ('pending') AND assignment_outcome IS NOT NULL`
        },
        {
            name: "2. Fix Unassigned shifts",
            sql: `UPDATE shifts SET assignment_outcome = NULL WHERE assignment_status = 'unassigned' AND assignment_outcome IS NOT NULL`
        },
        {
            name: "3. Fix OnBidding shifts",
            sql: `UPDATE shifts SET assignment_status = 'unassigned', assignment_outcome = NULL, assigned_employee_id = NULL WHERE bidding_status IN ('on_bidding_normal', 'on_bidding_urgent') AND assignment_status = 'assigned'`
        },
        {
            name: "4. Fix InProgress/Unassigned -> Cancelled",
            sql: `UPDATE shifts SET lifecycle_status = 'Cancelled' WHERE lifecycle_status IN ('InProgress', 'Completed') AND assignment_status = 'unassigned'`
        },
        {
            name: "5. Fix Trading status",
            sql: `UPDATE shifts SET trading_status = 'NoTrade' WHERE trading_status != 'NoTrade' AND (assignment_outcome != 'confirmed' OR assignment_outcome IS NULL)`
        },
        {
            name: "6. Fix Bidding status on Assigned",
            sql: `UPDATE shifts SET bidding_status = 'not_on_bidding' WHERE bidding_status IN ('on_bidding_normal', 'on_bidding_urgent') AND assignment_status = 'assigned'`
        },
        {
            name: "7. Clean Cancelled shifts",
            sql: `UPDATE shifts SET bidding_status = 'not_on_bidding', trading_status = 'NoTrade', assignment_outcome = NULL WHERE lifecycle_status = 'Cancelled'`
        }
    ];

    for (const step of steps) {
        console.log(`Executing: ${step.name}`);
        const { data, error } = await supabase.rpc('debug_exec_sql', { sql: step.sql });
        if (error) {
            console.error(`❌ Error in ${step.name}:`, error.message);
            if ((error as any).details) console.error('Details:', (error as any).details);
            return; // Stop on first error
        }
        console.log(`✅ Success`);
    }
}

run().catch(console.error);
