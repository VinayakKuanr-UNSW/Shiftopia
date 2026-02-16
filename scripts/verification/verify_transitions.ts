
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

// --- TYPE DEFINITIONS ---

interface TestResult {
    test_id: string;
    phase: string;
    name: string;
    status: 'pass' | 'fail' | 'error' | 'skip';
    expected: string;
    actual?: any;
    error?: string;
}

const report: { results: TestResult[], summary: any } = {
    results: [],
    summary: { total: 0, passed: 0, failed: 0 }
};

function addResult(result: TestResult) {
    report.results.push(result);
    report.summary.total++;
    if (result.status === 'pass') {
        report.summary.passed++;
        console.log(`PASS: ${result.name}`);
    } else {
        report.summary.failed++;
        console.error(`FAIL: ${result.name} - ${result.error || 'Check failed'} (Expected: ${result.expected})`);
    }
}

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) throw new Error(error.message);
    if (data && data.error) throw new Error(data.error);
    return data;
}

async function run() {
    console.log('--- PHASE 3: Transitions Audit ---');

    const ORG_ID = '00000000-0000-0000-0000-000000000001';
    const ROSTER_ID = '00000000-0000-0000-0000-000000000002';
    const DEPT_ID = '00000000-0000-0000-0000-000000000003';
    const ROLE_ID = '00000000-0000-0000-0000-000000000004';

    // IDs for Flow Tests
    const TEST_SHIFT_ID_B = '00000000-0000-0000-0000-0000000000b1';
    const TEST_SHIFT_ID_A = '00000000-0000-0000-0000-0000000000a2';
    const EMP_ID = '00000000-0000-0000-0000-0000000000e1';

    // 0. Ensure Dependencies (User + Profile)
    try {
        // Mock Auth User
        await execSql(`
            INSERT INTO auth.users (id, email, aud, role) 
            VALUES ('${EMP_ID}', 'john@test.com', 'authenticated', 'authenticated') 
            ON CONFLICT (id) DO NOTHING
        `);

        // Ensure Org/etc exist
        await execSql(`INSERT INTO organizations (id, name) VALUES ('${ORG_ID}', 'Test Org') ON CONFLICT (id) DO NOTHING`);
        await execSql(`INSERT INTO rosters (id, name, organization_id, start_date, end_date) VALUES ('${ROSTER_ID}', 'Test Roster', '${ORG_ID}', '2026-01-01', '2026-12-31') ON CONFLICT (id) DO NOTHING`);
        await execSql(`INSERT INTO departments (id, name, organization_id) VALUES ('${DEPT_ID}', 'Test Dept', '${ORG_ID}') ON CONFLICT (id) DO NOTHING`);
        await execSql(`INSERT INTO roles (id, name, department_id, level) VALUES ('${ROLE_ID}', 'Test Role', '${DEPT_ID}', 1) ON CONFLICT (id) DO NOTHING`);

        // Create Profile (Replacing Employee)
        await execSql(`
             WITH ins AS (
                INSERT INTO profiles (
                    id, first_name, last_name, email
                ) VALUES (
                    '${EMP_ID}', 'John', 'Doe', 'john@test.com'
                ) ON CONFLICT (id) DO NOTHING RETURNING id
            ) SELECT * FROM ins
         `);
    } catch (e: any) {
        console.error('FATAL: Setup Dependencies Failed:', e.message);
        process.exit(1);
    }

    // --- FLOW B: Unassigned -> Bidding ---
    console.log('\n--- FLOW B: Unassigned -> Bidding ---');
    try {
        await execSql(`DELETE FROM shifts WHERE id = '${TEST_SHIFT_ID_B}'`);
        await execSql(`
             WITH ins AS (
                INSERT INTO shifts (
                    id, organization_id, roster_id, department_id, role_id, shift_date, start_time, end_time,
                    lifecycle_status, assignment_status,
                    is_published, is_draft
                ) VALUES (
                    '${TEST_SHIFT_ID_B}', '${ORG_ID}', '${ROSTER_ID}', '${DEPT_ID}', '${ROLE_ID}', '2026-06-02', '10:00', '16:00',
                    'draft', 'unassigned',
                    false, true
                ) RETURNING id
            ) SELECT * FROM ins
        `);
        addResult({ test_id: 'FLOW-B-1', phase: 'Transitions', name: 'Create Draft Unassigned', status: 'pass', expected: 'Created' });
    } catch (e: any) {
        addResult({ test_id: 'FLOW-B-1', phase: 'Transitions', name: 'Create Draft Unassigned', status: 'error', expected: 'Created', error: e.message });
    }

    try {
        const { error } = await supabase.rpc('publish_shift', { p_shift_id: TEST_SHIFT_ID_B });
        if (error) throw error;
        const res = await execSql(`SELECT lifecycle_status, fulfillment_status, is_published FROM shifts WHERE id = '${TEST_SHIFT_ID_B}'`);
        const row = res[0];
        if (row.lifecycle_status === 'published' && row.fulfillment_status === 'bidding') {
            addResult({ test_id: 'FLOW-B-2', phase: 'Transitions', name: 'Publish Unassigned -> Bidding', status: 'pass', expected: 'published/bidding' });
        } else {
            addResult({ test_id: 'FLOW-B-2', phase: 'Transitions', name: 'Publish Unassigned -> Bidding', status: 'fail', expected: 'published/bidding', actual: row });
        }
    } catch (e: any) {
        addResult({ test_id: 'FLOW-B-2', phase: 'Transitions', name: 'Publish Unassigned', status: 'error', expected: 'Success', error: e.message });
    }

    // --- FLOW A: Assigned -> Offered ---
    console.log('\n--- FLOW A: Assigned -> Offered ---');

    try {
        await execSql(`DELETE FROM shifts WHERE id = '${TEST_SHIFT_ID_A}'`);
        await execSql(`
             WITH ins AS (
                INSERT INTO shifts (
                    id, organization_id, roster_id, department_id, role_id, shift_date, start_time, end_time,
                    lifecycle_status, assignment_status, assignment_outcome,
                    assigned_employee_id,
                    is_published, is_draft
                ) VALUES (
                    '${TEST_SHIFT_ID_A}', '${ORG_ID}', '${ROSTER_ID}', '${DEPT_ID}', '${ROLE_ID}', '2026-06-03', '10:00', '16:00',
                    'draft', 'assigned', 'pending',
                    '${EMP_ID}',
                    false, true
                ) RETURNING id
            ) SELECT * FROM ins
        `);
        addResult({ test_id: 'FLOW-A-1', phase: 'Transitions', name: 'Create Draft Assigned (Pending)', status: 'pass', expected: 'Created' });
    } catch (e: any) {
        addResult({ test_id: 'FLOW-A-1', phase: 'Transitions', name: 'Create Draft Assigned', status: 'error', expected: 'Created', error: e.message });
    }

    try {
        const { error } = await supabase.rpc('publish_shift', { p_shift_id: TEST_SHIFT_ID_A });
        if (error) throw error;

        const res = await execSql(`SELECT lifecycle_status, fulfillment_status, assignment_outcome, is_published FROM shifts WHERE id = '${TEST_SHIFT_ID_A}'`);
        const row = res[0];

        // Expect: Published + Offered (outcome=offered)
        if (row.lifecycle_status === 'published' && row.fulfillment_status === 'offered' && row.assignment_outcome === 'offered') {
            addResult({ test_id: 'FLOW-A-2', phase: 'Transitions', name: 'Publish Assigned -> Offered', status: 'pass', expected: 'published/offered' });
        } else {
            addResult({ test_id: 'FLOW-A-2', phase: 'Transitions', name: 'Publish Assigned -> Offered', status: 'fail', expected: 'published/offered', actual: row });
        }
    } catch (e: any) {
        addResult({ test_id: 'FLOW-A-2', phase: 'Transitions', name: 'Publish Assigned', status: 'error', expected: 'Success', error: e.message });
    }

    // --- FLOW C: Accept Offer ---
    console.log('\n--- FLOW C: Accept Offer ---');
    try {
        const { error } = await supabase.rpc('accept_shift_offer', {
            p_shift_id: TEST_SHIFT_ID_A,
            p_employee_id: EMP_ID
        });

        if (error) throw error;

        const res = await execSql(`SELECT lifecycle_status, fulfillment_status, assignment_outcome, assignment_status FROM shifts WHERE id = '${TEST_SHIFT_ID_A}'`);
        const row = res[0];

        // Expect: Published + Confirmed (outcome=confirmed)
        if (row.lifecycle_status === 'published' && row.fulfillment_status === 'scheduled' && row.assignment_outcome === 'confirmed') {
            addResult({ test_id: 'FLOW-C-1', phase: 'Transitions', name: 'Accept Offer -> Confirmed', status: 'pass', expected: 'published/scheduled/confirmed' });
        } else {
            addResult({ test_id: 'FLOW-C-1', phase: 'Transitions', name: 'Accept Offer -> Confirmed', status: 'fail', expected: 'published/scheduled/confirmed', actual: row });
        }
    } catch (e: any) {
        addResult({ test_id: 'FLOW-C-1', phase: 'Transitions', name: 'Accept Offer', status: 'error', expected: 'Success', error: e.message });
    }

    console.log('\n--- REPORT ---');
    console.log(JSON.stringify(report, null, 2));
}

run().catch(console.error);
