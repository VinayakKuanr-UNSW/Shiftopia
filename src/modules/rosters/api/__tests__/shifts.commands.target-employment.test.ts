/**
 * Write-path contract for `shifts.target_employment_type` /
 * `target_requires_flexible`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `target_employment_type` shipped in the baseline schema and was typed on
 * `CreateShiftData` from day one, yet it was NEVER persisted: `sm_create_shift`
 * builds an explicit `INSERT INTO shifts (...)` column list and simply did not
 * name the column. Setting the field succeeded, returned no error, and wrote
 * NULL (verified against prod 2026-08-05: 0 of 892 shifts had a non-NULL value).
 *
 * A silent drop like that is invisible to type-checking and to any test that
 * only asserts "the create resolved". So these tests assert on the PAYLOAD that
 * actually crosses the RPC boundary, which is the layer where the field went
 * missing. The matching DB half is migration
 * 20260805060000_sm_create_shift_target_employment_type_passthrough.sql.
 *
 * Network-free: supabase + the RPC client are mocked.
 *
 * NOTE ON THE FIXTURES. Both paths now run the Layer-1 shape gate before
 * touching the RPC, so the shifts below have to be lawful ones. They were
 * 09:00–17:00 with no breaks — eight hours with no meal break, which cl 36.1
 * forbids. That went unremarked for as long as nothing checked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    const rpcCalls: Array<{ fn: string; args: any }> = [];
    const tableOps: Array<{ table: string; method: string; args: unknown[] }> = [];

    function makeChain(table: string): any {
        const chain: any = new Proxy({}, {
            get(_t, prop) {
                if (typeof prop !== 'string') return undefined;
                // The direct-update path asserts it touched at least one row, so
                // an awaited chain must resolve to a non-empty result set.
                if (prop === 'then') {
                    return (res: any, rej: any) =>
                        Promise.resolve({ data: [{ id: 'shift-1' }], error: null }).then(res, rej);
                }
                if (prop === 'single' || prop === 'maybeSingle') {
                    return () => {
                        tableOps.push({ table, method: prop, args: [] });
                        return Promise.resolve({ data: { id: 'shift-1' }, error: null });
                    };
                }
                return (...args: unknown[]) => {
                    tableOps.push({ table, method: prop, args });
                    return chain;
                };
            },
        });
        return chain;
    }

    return {
        rpcCalls,
        tableOps,
        supabase: { from: (t: string) => makeChain(t) },
        reset: () => { rpcCalls.length = 0; tableOps.length = 0; },
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

vi.mock('@/platform/supabase/rpc/client', () => ({
    requireUser: async () => ({ id: 'user-1' }),
    callRpc: async (fn: string, args: any) => {
        h.rpcCalls.push({ fn, args });
        return 'new-shift-id';
    },
    callAuthenticatedRpc: async (fn: string, args: any) => {
        h.rpcCalls.push({ fn, args });
        return { code: 'APPLIED', version: 2 };
    },
    callAuthenticatedVoidRpc: async (fn: string, args: any) => {
        h.rpcCalls.push({ fn, args });
    },
}));

// Both paths re-read the shift: create returns the new row, update uses it for
// the "shift is in the past" guard. The date is far-future so that guard never
// trips and the tests stay time-independent.
//
// The breaks are not decoration. `updateShift` now runs the Layer-1 shape gate
// on the MERGED post-edit shift, so this row has to be a lawful one or every
// test here fails on cl 36.1 instead of on the thing it is testing. 09:00–17:30
// less a 30m unpaid break is 8h net: over the 7.6h full-time floor, carrying the
// meal break cl 36.1 requires and both rest pauses cl 37 requires.
vi.mock('../shifts.queries', () => ({
    shiftsQueries: {
        getShiftById: async (id: string) => ({
            id,
            version: 1,
            shift_date: '2099-01-01',
            start_time: '09:00',
            end_time: '17:30',
            unpaid_break_minutes: 30,
            paid_break_minutes: 30,
            is_training: false,
            role_id: null,
            roles: null,
        }),
    },
}));

vi.mock('../../services/compliance.service', () => ({
    complianceService: {
        validateShiftCompliance: async () => ({ isValid: true, violations: [] }),
    },
}));

import { shiftsCommands } from '../shifts.commands';

// A LAWFUL shift, deliberately. `createShift` now gates on shift shape before
// it builds the RPC payload, so a fixture that breaches the EBA never reaches
// the assertion it was written for. 8h net with a 30m unpaid meal break and 30m
// of paid rest pauses satisfies cl 12 (every target including the 7.6h
// full-time floor), cl 36.1 and cl 37.1–37.2.
const baseShift = {
    roster_id: 'r1',
    department_id: '11111111-1111-4111-8111-111111111111',
    shift_date: '2026-06-01',
    start_time: '09:00',
    end_time: '17:30',
    unpaid_break_minutes: 30,
    paid_break_minutes: 30,
};

function createPayload() {
    const call = h.rpcCalls.find(c => c.fn === 'sm_create_shift');
    expect(call, 'sm_create_shift was not called').toBeDefined();
    return call!.args.p_shift_data;
}

describe('createShift — employment target reaches the RPC payload', () => {
    beforeEach(() => h.reset());

    it('carries an FT target through to sm_create_shift', async () => {
        await shiftsCommands.createShift({ ...baseShift, target_employment_type: 'FT' } as any);

        const payload = createPayload();
        expect(payload.target_employment_type).toBe('FT');
        expect(payload.target_requires_flexible).toBe(false);
    });

    it('carries a flexible PT target as the (type, flag) pair', async () => {
        await shiftsCommands.createShift({
            ...baseShift,
            target_employment_type: 'PT',
            target_requires_flexible: true,
        } as any);

        const payload = createPayload();
        expect(payload.target_employment_type).toBe('PT');
        expect(payload.target_requires_flexible).toBe(true);
    });

    it('sends an explicit null for "Any", not an omitted key', async () => {
        // An omitted key would be indistinguishable from the old silent-drop bug.
        await shiftsCommands.createShift({ ...baseShift } as any);

        const payload = createPayload();
        expect(payload).toHaveProperty('target_employment_type');
        expect(payload.target_employment_type).toBeNull();
        expect(payload.target_requires_flexible).toBe(false);
    });

    it('clears the flexible flag when the target is not PT', async () => {
        // Otherwise the write trips shifts_target_flexible_requires_pt_check and
        // the planner sees a raw constraint error.
        for (const target of ['FT', 'Casual'] as const) {
            h.reset();
            await shiftsCommands.createShift({
                ...baseShift,
                target_employment_type: target,
                target_requires_flexible: true,
            } as any);

            expect(createPayload().target_requires_flexible).toBe(false);
        }
    });

    it('clears the flexible flag when the target is "Any"', async () => {
        await shiftsCommands.createShift({
            ...baseShift,
            target_requires_flexible: true,
        } as any);

        const payload = createPayload();
        expect(payload.target_employment_type).toBeNull();
        expect(payload.target_requires_flexible).toBe(false);
    });
});

describe('updateShift — employment target takes the direct-update path', () => {
    beforeEach(() => h.reset());

    /**
     * These keys are deliberately NOT in the gateway `edit` whitelist:
     * `_apply_shift_op_write` does not carry them, so routing them through
     * sm_apply_shift_op would silently drop them — the same failure this whole
     * file guards against. They must land on the direct `.update()` instead.
     */
    function directUpdatePayload() {
        const call = h.tableOps.find(o => o.table === 'shifts' && o.method === 'update');
        expect(call, 'no direct update on shifts').toBeDefined();
        return call!.args[0] as Record<string, unknown>;
    }

    it('writes the pair via the direct update, not the gateway op', async () => {
        await shiftsCommands.updateShift('shift-1', {
            target_employment_type: 'PT',
            target_requires_flexible: true,
        } as any);

        const payload = directUpdatePayload();
        expect(payload.target_employment_type).toBe('PT');
        expect(payload.target_requires_flexible).toBe(true);

        // Nothing employment-target-shaped should have gone to the gateway.
        const gateway = h.rpcCalls.find(c => c.fn === 'sm_apply_shift_op');
        expect(gateway?.args?.p_payload ?? {}).not.toHaveProperty('target_employment_type');
    });

    it('clears the target back to "Any" with an explicit null', async () => {
        await shiftsCommands.updateShift('shift-1', {
            target_employment_type: null,
        } as any);

        const payload = directUpdatePayload();
        expect(payload.target_employment_type).toBeNull();
        expect(payload.target_requires_flexible).toBe(false);
    });

    it('does not touch the columns when the caller omits the target', async () => {
        // An edit that only moves the shift time must not blank a target the
        // planner set earlier.
        await shiftsCommands.updateShift('shift-1', { tags: ['x'] } as any);

        const payload = directUpdatePayload();
        expect(payload).not.toHaveProperty('target_employment_type');
        expect(payload).not.toHaveProperty('target_requires_flexible');
    });
});
