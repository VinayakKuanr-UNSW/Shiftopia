
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function run() {
    const filePath = path.join(process.cwd(), 'supabase/migrations/20260125_014_implement_time_transition_rpc.sql');
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`Applying migration: ${filePath}`);
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });

    if (error) {
        console.error('Migration RPC Failed:', error.message);
        process.exit(1);
    }

    // Check for internal error returned by the RPC
    if (data && typeof data === 'object' && 'error' in data && (data as any).error) {
        console.error('Migration Execution Failed:', (data as any).error);
        process.exit(1);
    }

    console.log('Migration Result:', JSON.stringify(data, null, 2));
    console.log('Migration Applied Successfully');
}

run().catch(console.error);
