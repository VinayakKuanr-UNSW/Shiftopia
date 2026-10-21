/**
 * `shiftsCommands.bulkPublishShifts` — the write behind the toolbar's Publish
 * and the bulk toolbar's Publish.
 *
 * WHY THIS EXISTS
 * ---------------
 * Its compliance pre-check failed OPEN in two ways, both observed against the
 * real code on 2026-10-18:
 *   1. Each shift was re-read with `getShiftById`, which returns `null` on ANY
 *      error. `null` has no assignee, so the shift was treated as unassigned
 *      and published with no compliance check at all.
 *   2. When the `evaluate-compliance` edge function errored, the local fallback
 *      checked only past-date / start=end and reported `passed`.
 * And it fired every read and every compliance call at once: 2N+1 requests,
 * all N in flight (N = 500 measured) — exactly the burst that makes the edge
 * function error and so triggers (2).
 *
 * The REAL compliance service runs here; only the network is mocked
 * (`supabase.functions.invoke`, the batched shift read, the RPC client).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    rpcCalls: [] as Array<{ fn: string; args: any }>,
    rpcResult: null as null | ((args: any) => any),
    loadCalls: [] as string[][],
    loadRows: (async (_ids: string[]) => new Map()) as (ids: string[]) => Promise<Map<string, any>>,
    inCalls: [] as Array<{ col: string; vals: any[] }>,
    inResult: null as null | ((col: string, vals: any[]) => Promise<{ data: any[]; error: any }>),
    invoke: (async () => ({ data: null, error: null })) as (...a: any[]) => Promise<any>,
    invokeCount: 0,
    inFlight: 0,
    maxInFlight: 0,
}));

vi.mock('@/platform/supabase/client', () => {
    return {
        supabase: {
            from: () => {
                let lastIn: { col: string; vals: any[] } | null = null;
                const chain: any = {
                    select: () => chain,
                    in: (col: string, vals: any[]) => {
                        lastIn = { col, vals };
                        h.inCalls.push(lastIn);
                        return chain;
                    },
                    then: (resolve: any, reject: any) => {
                        if (h.inResult && lastIn) {
                            return h.inResult(lastIn.col, lastIn.vals).then(resolve, reject);
                        }
                        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                    },
                };
                return chain;
            },
            functions: {
                invoke: async (...args: any[]) => {
                    h.invokeCount++;
                    h.inFlight++;
                    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
                    await new Promise(r => setTimeout(r, 1));
                    h.inFlight--;
                    return h.invoke(...args);
                },
            },
        },
    };
});

vi.mock('@/platform/supabase/rpc/client', () => ({
    requireUser: async () => ({ id: 'user-1' }),
    callRpc: async (fn: string, args: any) => { h.rpcCalls.push({ fn, args }); return { code: 'APPLIED' }; },
    callAuthenticatedRpc: async (fn: string, paramsFn: (u: string) => any) => {
        const args = paramsFn('user-1');
        h.rpcCalls.push({ fn, args });
        if (h.rpcResult) return h.rpcResult(args);
        const n = args.p_shift_ids?.length ?? 0;
        return { success: true, total_requested: n, success_count: n, failure_count: 0 };
    },
    callAuthenticatedVoidRpc: async () => undefined,
}));

vi.mock('../shifts.queries', () => ({
    shiftsQueries: {
        getPublishCheckRows: async (ids: string[]) => {
            h.loadCalls.push(ids);
            return h.loadRows(ids);
        },
    },
}));

import { shiftsCommands } from '../shifts.commands';

const EMP = '11111111-1111-4111-8111-111111111111';
const IN_10_DAYS = new Date(Date.now() + 10 * 86_400_000);
const shift = (id: string, assigned = true) => ({
    id,
    shift_date: IN_10_DAYS.toISOString().slice(0, 10),
    start_time: '09:00:00',
    end_time: '15:00:00',
    start_at: IN_10_DAYS.toISOString(),
    unpaid_break_minutes: 30,
    assigned_employee_id: assigned ? EMP : null,
});
const rowsFor = (ids: string[], assigned = true) => new Map(ids.map(id => [id, shift(id, assigned)]));
const passed = { status: 'passed', violations: [], warnings: [], weeklyHours: 6, maxWeeklyHours: 48, checksPerformed: ['overlap', 'weekly_hours', 'rest_period', 'qualification'], checksSkipped: [], qualificationViolations: [] };
const publishCalls = () => h.rpcCalls.filter(c => c.fn === 'sm_bulk_publish_shifts');

beforeEach(() => {
    h.rpcCalls.length = 0;
    h.loadCalls.length = 0;
    h.inCalls.length = 0;
    h.inResult = null;
    h.invokeCount = h.inFlight = h.maxInFlight = 0;
    h.rpcResult = null;
    h.loadRows = async (ids) => rowsFor(ids);
    h.invoke = async () => ({ data: passed, error: null });
});

describe('bulkPublishShifts — reading the shifts', () => {
    it('reads every shift in one batched call, not one request per shift', async () => {
        const ids = Array.from({ length: 250 }, (_, i) => `s-${i}`);

        await shiftsCommands.bulkPublishShifts(ids);

        expect(h.loadCalls).toHaveLength(1);
        expect(h.loadCalls[0]).toEqual(ids);
    });

    it('publishes nothing when the shifts cannot be read — it does not treat them as unassigned', async () => {
        h.loadRows = async () => { throw new Error('FetchError: network down'); };

        const res = await shiftsCommands.bulkPublishShifts(['a', 'b']);

        expect(publishCalls()).toHaveLength(0);
        expect(res.publishedIds).toEqual([]);
        expect(res.complianceFailed.map(f => f.id)).toEqual(['a', 'b']);
        expect(res.complianceFailed[0].reason).toMatch(/could not load/i);
        expect(res.complianceFailed[0].reason).toMatch(/network down/);
    });

    it('does not publish a shift missing from the read, and still publishes the rest', async () => {
        h.loadRows = async () => rowsFor(['a', 'c']);

        const res = await shiftsCommands.bulkPublishShifts(['a', 'b', 'c']);

        expect(res.complianceFailed).toEqual([{ id: 'b', reason: expect.stringMatching(/not found/i) }]);
        expect(publishCalls()[0].args.p_shift_ids).toEqual(['a', 'c']);
    });
});

describe('bulkPublishShifts — compliance fails closed', () => {
    it('blocks an assigned shift when the compliance engine is unreachable', async () => {
        h.invoke = async () => ({ data: null, error: new Error('FunctionsHttpError: 503') });

        const res = await shiftsCommands.bulkPublishShifts(['a']);

        expect(publishCalls()).toHaveLength(0);
        expect(res.publishedIds).toEqual([]);
        expect(res.complianceFailed).toEqual([{ id: 'a', reason: expect.stringMatching(/unreachable/i) }]);
    });

    it('blocks an assigned shift the engine reports as violating, with the engine\'s reason', async () => {
        h.invoke = async () => ({
            data: { ...passed, status: 'violated', violations: ['Minimum rest period of 11 hours between consecutive shifts is not met'] },
            error: null,
        });

        const res = await shiftsCommands.bulkPublishShifts(['a']);

        expect(publishCalls()).toHaveLength(0);
        expect(res.complianceFailed[0].reason).toMatch(/Minimum rest period/);
    });

    it('sends shifts that passed to sm_bulk_publish_shifts', async () => {
        const res = await shiftsCommands.bulkPublishShifts(['a', 'b']);

        expect(publishCalls()).toHaveLength(1);
        expect(publishCalls()[0].args.p_shift_ids).toEqual(['a', 'b']);
        expect(res.publishedIds).toEqual(['a', 'b']);
        expect(res.complianceFailed).toEqual([]);
    });

    it('does not call the engine for an unassigned future shift (there is nobody to check)', async () => {
        h.loadRows = async (ids) => rowsFor(ids, false);

        const res = await shiftsCommands.bulkPublishShifts(['a']);

        expect(h.invokeCount).toBe(0);
        expect(res.publishedIds).toEqual(['a']);
    });
});

describe('bulkPublishShifts — request volume', () => {
    it('keeps at most 5 compliance calls in flight (DEFAULT_CHUNK_CONCURRENCY), and still checks every shift', async () => {
        const ids = Array.from({ length: 200 }, (_, i) => `s-${i}`);

        await shiftsCommands.bulkPublishShifts(ids);

        expect(h.invokeCount).toBe(200);
        expect(h.maxInFlight).toBeLessThanOrEqual(5);
    });
});

describe('bulkPublishShifts — when the server refuses the batch', () => {
    it('keeps the server\'s reason (it is sent as `error`, not `message`)', async () => {
        h.rpcResult = () => ({ success: false, error: 'Not authorised: shift.publish is not granted to you in this scope' });

        const res = await shiftsCommands.bulkPublishShifts(['a', 'b']);

        expect(res.publishedIds).toEqual([]);
        expect(res.dbFailed.map(f => f.reason)).toEqual([
            'Not authorised: shift.publish is not granted to you in this scope',
            'Not authorised: shift.publish is not granted to you in this scope',
        ]);
    });
});

describe('bulkPublishShifts — discrepancy verification batching', () => {
    it('chunks verification queries into batches of <=100 IDs when RPC reports discrepancy', async () => {
        const ids = Array.from({ length: 250 }, (_, i) => `shift-${i}`);
        // Return discrepancy: success_count is 240, failure_count is 10 (less than 250)
        h.rpcResult = () => ({ success: true, total_requested: 250, success_count: 240, failure_count: 10 });

        // Simulate DB verification: all except first 10 are Published
        h.inResult = async (_col, vals) => ({
            data: vals.map(id => ({
                id,
                lifecycle_status: ids.indexOf(id) < 10 ? 'Draft' : 'Published',
            })),
            error: null,
        });

        const res = await shiftsCommands.bulkPublishShifts(ids);

        // Verify that inCalls were chunked into batches of at most 100
        expect(h.inCalls.length).toBe(3); // 100 + 100 + 50 = 250
        expect(h.inCalls[0].vals.length).toBe(100);
        expect(h.inCalls[1].vals.length).toBe(100);
        expect(h.inCalls[2].vals.length).toBe(50);

        expect(res.publishedIds.length).toBe(240);
        expect(res.dbFailed.length).toBe(10);
        expect(res.dbFailed[0].reason).toMatch(/Skipped by server/);
    });
});

