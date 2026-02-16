
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

interface VerificationReport {
    timestamp: string;
    summary: { total: number; passed: number; failed: number; errors: number };
    failures: TestResult[];
    results: TestResult[];
}

const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, errors: 0 },
    failures: [],
    results: []
};


function addResult(result: TestResult) {
    report.results.push(result);
    report.summary.total++;
    if (result.status === 'pass') report.summary.passed++;
    else if (result.status === 'fail') {
        report.summary.failed++;
        report.failures.push(result);
        console.error(`FAILED: ${result.name} - ${result.error || 'State mismatch'}`);
    } else if (result.status === 'error') {
        report.summary.errors++;
        report.failures.push(result);
        console.error(`ERROR: ${result.name} - ${result.error}`);
    } else {
        console.log(`PASS: ${result.name}`);
    }
}

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) throw new Error(error.message);
    if (data && data.error) throw new Error(data.error);
    return data;
}

// --- PHASES ---

async function phase1_Schema() {
    console.log('\n--- PHASE 1: Schema Verification ---');

    // 1.1 Check Enums
    const ENUMS_TO_CHECK = [
        { type: 'shift_lifecycle_status', values: ['draft', 'published', 'in_progress', 'completed', 'cancelled'] },
        { type: 'shift_fulfillment_status', values: ['scheduled', 'bidding', 'offered', 'none'] }
    ];

    for (const check of ENUMS_TO_CHECK) {
        try {
            const res = await execSql(`
                SELECT enumlabel FROM pg_enum 
                WHERE enumtypid = '${check.type}'::regtype 
                ORDER BY enumsortorder
            `);
            const actual = res ? res.map((r: any) => r.enumlabel).map((v: any) => v.toLowerCase()) : [];
            const expected = check.values.map(v => v.toLowerCase());

            const missing = expected.filter(v => !actual.includes(v));

            if (missing.length === 0) {
                addResult({ test_id: `SCHEMA-${check.type}`, phase: 'Schema', name: `Enum ${check.type}`, status: 'pass', expected: check.values.join(',') });
            } else {
                addResult({ test_id: `SCHEMA-${check.type}`, phase: 'Schema', name: `Enum ${check.type}`, status: 'fail', expected: check.values.join(','), actual, error: `Missing: ${missing.join(',')}` });
            }
        } catch (e: any) {
            addResult({ test_id: `SCHEMA-${check.type}`, phase: 'Schema', name: `Enum ${check.type}`, status: 'error', expected: 'Exists', error: e.message });
        }
    }
}

async function phase2_StateCombinations() {
    console.log('\n--- PHASE 2: State Combinations ---');

    const ORG_ID = '00000000-0000-0000-0000-000000000001';
    const ROSTER_ID = '00000000-0000-0000-0000-000000000002';
    const DEPT_ID = '00000000-0000-0000-0000-000000000003';
    const ROLE_ID = '00000000-0000-0000-0000-000000000004';

    // Setup and Verify Org
    try {
        await execSql(`
            WITH ins AS (
                INSERT INTO organizations (id, name) VALUES ('${ORG_ID}', 'Test Org') ON CONFLICT (id) DO NOTHING RETURNING id
            ) SELECT * FROM ins
        `);
        const orgCheck = await execSql(`SELECT count(*) as c FROM organizations WHERE id = '${ORG_ID}'`);
        const count = orgCheck[0]?.c || 0;
        console.log('Org Count:', count);
        if (count == 0) throw new Error('Org creation failed or row not found');
    } catch (e: any) {
        console.error('FATAL: Setup Org Failed:', e.message);
        process.exit(1);
    }

    // Setup and Verify Roster
    try {
        await execSql(`
            WITH ins AS (
                INSERT INTO rosters (id, name, organization_id, start_date, end_date) 
                VALUES ('${ROSTER_ID}', 'Test Roster', '${ORG_ID}', '2026-01-01', '2026-12-31') 
                ON CONFLICT (id) DO NOTHING RETURNING id
            ) SELECT * FROM ins
        `);
        const rosterCheck = await execSql(`SELECT count(*) as c FROM rosters WHERE id = '${ROSTER_ID}'`);
        const count = rosterCheck[0]?.c || 0;
        console.log('Roster Count:', count);
        if (count == 0) throw new Error('Roster creation failed or row not found');
    } catch (e: any) {
        console.error('FATAL: Setup Roster Failed:', e.message);
        process.exit(1);
    }

    // Setup and Verify Dept
    try {
        await execSql(`
            WITH ins AS (
                INSERT INTO departments (id, name, organization_id) VALUES ('${DEPT_ID}', 'Test Dept', '${ORG_ID}') ON CONFLICT (id) DO NOTHING RETURNING id
            ) SELECT * FROM ins
        `);
    } catch (e: any) {
        console.error('FATAL: Setup Dept Failed:', e.message);
        process.exit(1);
    }

    // Setup and Verify Role
    try {
        await execSql(`
            WITH ins AS (
                INSERT INTO roles (id, name, department_id, level) VALUES ('${ROLE_ID}', 'Test Role', '${DEPT_ID}', 1) ON CONFLICT (id) DO NOTHING RETURNING id
            ) SELECT * FROM ins
        `);
    } catch (e: any) {
        console.error('FATAL: Setup Role Failed:', e.message);
        process.exit(1);
    }


    try {
        // Cleanup first
        await execSql(`
            WITH del AS (
                DELETE FROM shifts WHERE id = '00000000-0000-0000-0000-0000000000a1' RETURNING id
            ) SELECT * FROM del
        `);

        await execSql(`
            WITH ins AS (
                INSERT INTO shifts (
                    id, organization_id, roster_id, department_id, role_id, shift_date, start_time, end_time,
                    lifecycle_status, assignment_status_text, fulfillment_status, 
                    is_published, is_draft
                ) VALUES (
                    '00000000-0000-0000-0000-0000000000a1', '${ORG_ID}', '${ROSTER_ID}', '${DEPT_ID}', '${ROLE_ID}', '2026-06-01', '09:00', '17:00',
                    'draft', 'unassigned', 'none',
                    false, true
                ) RETURNING id
            ) SELECT * FROM ins
        `);
        addResult({ test_id: 'COMBO-S1', phase: 'Combos', name: 'S1 (Draft/Unassigned)', status: 'pass', expected: 'Success' });
    } catch (e: any) {
        addResult({ test_id: 'COMBO-S1', phase: 'Combos', name: 'S1 (Draft/Unassigned)', status: 'fail', expected: 'Success', error: e.message });
    }

    // Test Invalid: Draft + Confirmed
    try {
        // Cleanup
        await execSql(`
            WITH del AS (
                DELETE FROM shifts WHERE id = '00000000-0000-0000-0000-0000000000b1' RETURNING id
            ) SELECT * FROM del
         `);

        await execSql(`
            WITH ins AS (
                INSERT INTO shifts (
                    id, organization_id, roster_id, department_id, role_id, shift_date, start_time, end_time,
                    lifecycle_status, assignment_status_text,
                    assignment_outcome
                ) VALUES (
                    '00000000-0000-0000-0000-0000000000b1', '${ORG_ID}', '${ROSTER_ID}', '${DEPT_ID}', '${ROLE_ID}', '2026-06-01', '09:00', '17:00',
                    'draft', 'assigned',
                    'confirmed'
                ) RETURNING id
            ) SELECT * FROM ins
        `);
        addResult({ test_id: 'COMBO-INV-1', phase: 'Combos', name: 'Invalid (Draft+Confirmed)', status: 'fail', expected: 'Error', error: 'Database accepted invalid state' });
    } catch (e: any) {
        addResult({ test_id: 'COMBO-INV-1', phase: 'Combos', name: 'Invalid (Draft+Confirmed)', status: 'pass', expected: 'Error' });
    }
}

// --- MAIN ---

(async () => {
    try {
        await phase1_Schema();
        await phase2_StateCombinations();
    } catch (e) {
        console.error('Test Suite Failed:', e);
    } finally {
        console.log('\n--- REPORT ---');
        console.log(JSON.stringify(report, null, 2));
    }
})();
