
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) process.exit(1);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

interface TestResult {
    name: string;
    passed: boolean;
    details?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean | string>) {
    try {
        const result = await fn();
        const passed = result === true;
        results.push({
            name,
            passed,
            details: typeof result === 'string' ? result : undefined
        });
        console.log(passed ? `✅ ${name}` : `❌ ${name}: ${result}`);
    } catch (error: any) {
        results.push({ name, passed: false, details: String(error) });
        console.log(`❌ ${name}: ${error.message}`);
    }
}

async function execSql(sql: string) {
    const { data, error } = await supabase.rpc('debug_exec_sql', { sql });
    if (error) throw error;
    // debug_exec_sql returns { success, result, ... } or raw json
    // Adjust based on implementation. Assuming it returns the result of jsonb_agg if successful.
    if (data && (data as any).error) throw new Error((data as any).error);
    return data;
}

async function checkColumnExists(colName: string) {
    const data = await execSql(`SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = '${colName}'`);
    return data && data.length > 0;
}

async function main() {
    console.log('\n=== Schema Standardization Verification ===\n');

    // 7.1.1 Verify shift_lifecycle enum exists
    await test('shift_lifecycle enum exists', async () => {
        const data = await execSql(`
        SELECT array_agg(enumlabel ORDER BY enumsortorder) as values
        FROM pg_enum
        WHERE enumtypid = 'shift_lifecycle'::regtype
    `);
        const expected = ['Draft', 'Published', 'InProgress', 'Completed', 'Cancelled'];
        const actual = data?.[0]?.values;

        if (!actual) return 'Enum Not Found';

        // JSON parse if needed or straightforward comparison
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            return `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        }
        return true;
    });

    // 7.1.2 Verify shift_trading enum exists
    await test('shift_trading enum exists', async () => {
        const data = await execSql(`
        SELECT array_agg(enumlabel ORDER BY enumsortorder) as values
        FROM pg_enum
        WHERE enumtypid = 'shift_trading'::regtype
    `);
        const expected = ['NoTrade', 'TradeRequested', 'TradeAccepted', 'TradeApproved'];
        const actual = data?.[0]?.values;

        if (!actual) return 'Enum Not Found';

        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            return `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        }
        return true;
    });

    // 7.1.3 Verify trading_status column exists
    await test('trading_status column exists', async () => {
        const data = await execSql(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'trading_status'
    `);
        if (!data || data.length === 0) return 'Column not found';
        if (data[0].is_nullable !== 'NO') return 'Column should be NOT NULL';
        return true;
    });

    // 4. Verify Cleanup (Phase 3)
    console.log('\n=== Cleanup Verification ===');
    const colsToCheck = ['employee_id', 'is_trade_requested', 'assignment_status_text'];
    for (const col of colsToCheck) {
        await test(`Column '${col}' is removed`, async () => {
            const exists = await checkColumnExists(col);
            if (exists) {
                return `Column '${col}' still exists (Should be removed)`;
            }
            return true;
        });
    }

    // Check View Access
    await test('shifts_with_state View operational', async () => {
        const { error: viewError } = await supabase.from('shifts_with_state').select('id, state_id').limit(1);
        if (viewError) {
            return `shifts_with_state View broken: ${viewError.message}`;
        }
        return true;
    });

    // 7.1.4 Verify lifecycle_status is enum (not text)
    await test('lifecycle_status is enum type', async () => {
        const data = await execSql(`
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name = 'lifecycle_status'
    `);
        if (!data || data.length === 0) return 'Column not found';
        if (data[0].data_type !== 'USER-DEFINED' || data[0].udt_name !== 'shift_lifecycle') {
            return `Expected shift_lifecycle enum, got ${data[0].data_type} / ${data[0].udt_name}`;
        }
        return true;
    });


    // 5. Verify Missing RPCs (Phase 4)
    console.log('\n=== RPC Verification ===');
    const rpcsToCheck = ['select_bidding_winner', 'close_bidding_no_winner', 'process_shift_time_transitions'];
    for (const rpc of rpcsToCheck) {
        await test(`RPC '${rpc}' exists`, async () => {
            const data = await execSql(`SELECT 1 FROM pg_proc WHERE proname = '${rpc}'`);
            return data && data.length > 0;
        });
    }

    console.log('\n=== Summary ===');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`Passed: ${passed}/${results.length}`);
    console.log(`Failed: ${failed}/${results.length}`);

    if (failed > 0) {
        process.exit(1);
    }
}

main();
