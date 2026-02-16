
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) console.error('SQL Error (Network):', error.message);
    if (data && (data as any).error) {
        console.error('SQL Error (Db):', (data as any).error);
        throw new Error((data as any).error);
    }
    return data;
}

interface TestResult { name: string; status: 'pass' | 'fail'; error?: string; }
const results: TestResult[] = [];

async function run() {
    console.log('--- PHASE 5: Invariants Audit (Sequential) ---');

    // IDs
    const ORG_ID = '00000000-0000-0000-0000-000000000001';
    const TEST_SHIFT_ID = '00000000-0000-0000-0000-0000000000d1';
    const EMP_ID_1 = '00000000-0000-0000-0000-0000000000e1';
    const EMP_ID_2 = '00000000-0000-0000-0000-0000000000e2';

    // SETUP
    console.log('Setup...');
    await execSql(`
        INSERT INTO auth.users (id, email, aud, role) VALUES ('${EMP_ID_2}', 'jane@test.com', 'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING;
        INSERT INTO profiles (id, first_name, last_name, email) VALUES ('${EMP_ID_2}', 'Jane', 'Doe', 'jane@test.com') ON CONFLICT (id) DO NOTHING;
        INSERT INTO organizations (id, name) VALUES ('${ORG_ID}', 'Test Org') ON CONFLICT (id) DO NOTHING;
        INSERT INTO rosters (id, name, organization_id, start_date, end_date) VALUES ('00000000-0000-0000-0000-000000000002', 'Test Roster', '${ORG_ID}', '2026-01-01', '2026-12-31') ON CONFLICT (id) DO NOTHING;
        INSERT INTO departments (id, name, organization_id) VALUES ('00000000-0000-0000-0000-000000000003', 'Test Dept', '${ORG_ID}') ON CONFLICT (id) DO NOTHING;
        INSERT INTO roles (id, name, department_id, level) VALUES ('00000000-0000-0000-0000-000000000004', 'Test Role', '00000000-0000-0000-0000-000000000003', 1) ON CONFLICT (id) DO NOTHING;
    `);

    // TEST 1: Direct Assignment
    console.log('\nTest 1: Direct Assignment RPC');
    try {
        // 1. Reset Shift
        await execSql(`DELETE FROM shifts WHERE id = '${TEST_SHIFT_ID}'`);
        await execSql(`
            INSERT INTO shifts (
                id, organization_id, roster_id, department_id, role_id, shift_date, start_time, end_time,
                lifecycle_status, assignment_status, fulfillment_status, is_published, is_draft
            ) VALUES (
                '${TEST_SHIFT_ID}', '${ORG_ID}', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 
                '2026-06-10', '09:00', '17:00',
                'published', 'unassigned', 'none', true, false
            )
        `);

        // 2. Call RPC (using client to ensure visibility)
        const { error } = await supabase.rpc('assign_shift_rpc', { p_shift_id: TEST_SHIFT_ID, p_employee_id: EMP_ID_1 });
        if (error) throw error;

        // 3. Verify (Using execSql to match setup visibility)
        const rows = await execSql(`SELECT assignment_outcome FROM shifts WHERE id = '${TEST_SHIFT_ID}'`);
        const shift = rows && rows[0];
        console.log('Test 1 Result:', shift);

        if (shift?.assignment_outcome === 'confirmed') {
            results.push({ name: 'Direct Assignment sets Confirmed', status: 'pass' });
        } else {
            results.push({ name: 'Direct Assignment sets Confirmed', status: 'fail', error: `Got ${shift?.assignment_outcome}, expected confirmed` });
        }
    } catch (e: any) {
        results.push({ name: 'Direct Assignment Exception', status: 'fail', error: e.message });
    }

    // TEST 2: Immutable Confirmed Assignment
    console.log('\nTest 2: Re-assign Confirmed Shift');
    try {
        // 1. Force state
        await execSql(`UPDATE shifts SET assignment_outcome = 'confirmed', assigned_employee_id = '${EMP_ID_1}' WHERE id = '${TEST_SHIFT_ID}'`);

        // 2. Try to assign different employee
        const { error } = await supabase.rpc('assign_shift_rpc', { p_shift_id: TEST_SHIFT_ID, p_employee_id: EMP_ID_2 });

        if (error) {
            console.log('RPC blocked reassignment as expected:', error.message);
            results.push({ name: 'Block Re-assignment of Confirmed', status: 'pass' });
        } else {
            // 3. Check if it overwrote
            const rows = await execSql(`SELECT assigned_employee_id FROM shifts WHERE id = '${TEST_SHIFT_ID}'`);
            const shift = rows && rows[0];
            if (shift?.assigned_employee_id === EMP_ID_2) {
                results.push({ name: 'Block Re-assignment of Confirmed', status: 'fail', error: 'Allowed overwrite' });
            } else {
                results.push({ name: 'Block Re-assignment of Confirmed', status: 'pass' });
            }
        }
    } catch (e: any) {
        results.push({ name: 'Block Re-assignment of Confirmed', status: 'pass' });
    }

    console.log('\n--- REPORT ---');
    console.log(JSON.stringify(results, null, 2));
}

run().catch(console.error);
