/**
 * The reads the toolbar's Publish decides from.
 *
 * WHY THIS EXISTS
 * ---------------
 * Publish used to plan from `getShiftsForDateRange`, the grid's fetch. That
 * fetch degrades for display: a failed page returns the rows it already had,
 * an exception returns `[]`, and past 8,000 rows it truncates. Fine for a grid,
 * wrong for a write — a timeout on page 2 of 3 planned 1,000 of 2,500 drafts,
 * published those, and said "Roster published"; a failed first page read as
 * "nothing to publish". The strict read below must either return every shift
 * in the view or throw.
 *
 * Network-free: the supabase query builder is mocked. Each `from()` is one
 * request; awaiting it pops the next queued response.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
    type Op = { method: string; args: unknown[] };
    const requests: Op[][] = [];
    let queue: Array<{ data: unknown[] | null; error: unknown }> = [];

    function makeChain(ops: Op[]): any {
        return new Proxy({}, {
            get(_t, prop) {
                if (typeof prop !== 'string') return undefined;
                if (prop === 'then') {
                    return (res: any, rej: any) =>
                        Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
                }
                return (...args: unknown[]) => {
                    ops.push({ method: prop, args });
                    return makeChain(ops);
                };
            },
        });
    }

    return {
        requests,
        setQueue: (q: typeof queue) => { queue = q; },
        reset: () => { requests.length = 0; queue = []; },
        supabase: {
            from: (table: string) => {
                const ops: Op[] = [{ method: 'from', args: [table] }];
                requests.push(ops);
                return makeChain(ops);
            },
        },
    };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));

import { shiftsQueries, ShiftRangeIncompleteError } from '../shifts.queries';

const ORG = '22222222-2222-4222-8222-222222222222';
const DEPT = '33333333-3333-4333-8333-333333333333';
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const row = (i: number) => ({
    id: id(i),
    organization_id: ORG,
    shift_date: '2099-11-20',
    start_time: '09:00:00',
    end_time: '15:00:00',
    lifecycle_status: 'Draft',
    assigned_employee_id: null,
});
const page = (from: number, n: number) => ({ data: Array.from({ length: n }, (_, i) => row(from + i)), error: null });
const ops = (req: number, method: string) => h.requests[req].filter(o => o.method === method);

beforeEach(() => h.reset());

describe('getShiftsForDateRangeStrict — the Publish plan read', () => {
    it('returns every shift across pages, paging by id so no row is skipped or repeated', async () => {
        h.setQueue([page(0, 1000), page(1000, 1000), page(2000, 500)]);

        const rows = await shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30');

        expect(rows).toHaveLength(2500);
        expect(new Set(rows.map(r => r.id)).size).toBe(2500);
        expect(h.requests).toHaveLength(3);
        // Keyset: each later page starts after the last id of the one before.
        expect(ops(0, 'gt')).toEqual([]);
        expect(ops(1, 'gt')).toEqual([{ method: 'gt', args: ['id', id(999)] }]);
        expect(ops(2, 'gt')).toEqual([{ method: 'gt', args: ['id', id(1999)] }]);
        for (let r = 0; r < 3; r++) {
            expect(ops(r, 'order')).toEqual([{ method: 'order', args: ['id'] }]);
            expect(ops(r, 'limit')).toEqual([{ method: 'limit', args: [1000] }]);
        }
    });

    it('throws when a later page fails, instead of returning the rows it already had', async () => {
        h.setQueue([
            page(0, 1000),
            { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } },
            page(2000, 500),
        ]);

        await expect(shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30'))
            .rejects.toThrow(ShiftRangeIncompleteError);
    });

    it('throws when the first page fails, so a failed read never looks like an empty roster', async () => {
        h.setQueue([{ data: null, error: { message: 'FetchError: network down' } }]);

        await expect(shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30'))
            .rejects.toThrow(/network down/);
    });

    it('refuses a view over custom rowCap rather than silently planning the first batch', async () => {
        h.setQueue(Array.from({ length: 9 }, (_, p) => page(p * 1000, 1000)));

        await expect(shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30', { rowCap: 8000 }))
            .rejects.toThrow(/8,000/);
    });

    it('accepts up to the custom cap as complete', async () => {
        h.setQueue([...Array.from({ length: 8 }, (_, p) => page(p * 1000, 1000)), page(8000, 0)]);

        const rows = await shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30', { rowCap: 8000 });

        expect(rows).toHaveLength(8000);
    });

    it('defaults to 25,000 cap unblocking month-level planning for large orgs', async () => {
        h.setQueue(Array.from({ length: 26 }, (_, p) => page(p * 1000, 1000)));

        await expect(shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30'))
            .rejects.toThrow(/25,000/);
    });

    it('accepts large month views (e.g. 12,500 shifts) with default cap', async () => {
        h.setQueue([...Array.from({ length: 13 }, (_, p) => page(p * 1000, p === 12 ? 500 : 1000))]);

        const rows = await shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30');

        expect(rows).toHaveLength(12500);
    });

    it('scopes the read exactly as the grid does: organisation, dates, departments', async () => {
        h.setQueue([page(0, 3)]);

        await shiftsQueries.getShiftsForDateRangeStrict(ORG, '2099-11-01', '2099-11-30', { departmentIds: [DEPT] });

        const methods = h.requests[0];
        expect(methods).toEqual(expect.arrayContaining([
            { method: 'eq', args: ['organization_id', ORG] },
            { method: 'gte', args: ['shift_date', '2099-11-01'] },
            { method: 'lte', args: ['shift_date', '2099-11-30'] },
            { method: 'in', args: ['department_id', [DEPT]] },
        ]));
    });

    it('throws for a missing organisation instead of returning nothing', async () => {
        await expect(shiftsQueries.getShiftsForDateRangeStrict('not-a-uuid', '2099-11-01', '2099-11-30'))
            .rejects.toThrow(ShiftRangeIncompleteError);
        expect(h.requests).toHaveLength(0);
    });
});

describe('getShiftsForDateRange — the grid read keeps degrading for display', () => {
    it('still returns the rows it had when a later page fails (unchanged behaviour)', async () => {
        h.setQueue([page(0, 1000), { data: null, error: { message: 'timeout' } }]);

        const rows = await shiftsQueries.getShiftsForDateRange(ORG, '2099-11-01', '2099-11-30');

        expect(rows).toHaveLength(1000);
    });

    it('ends its sort on id, so offset pages over tied rows neither skip nor repeat', async () => {
        h.setQueue([page(0, 3)]);

        await shiftsQueries.getShiftsForDateRange(ORG, '2099-11-01', '2099-11-30');

        expect(ops(0, 'order').map(o => o.args[0])).toEqual(['shift_date', 'display_order', 'start_time', 'id']);
    });
});

describe('getPublishCheckRows — one batched read for bulk publish', () => {
    it('reads the shifts in chunks of 100 ids, not one request per shift', async () => {
        const ids = Array.from({ length: 250 }, (_, i) => id(i));
        h.setQueue([page(0, 100), page(100, 100), page(200, 50)]);

        const byId = await shiftsQueries.getPublishCheckRows(ids);

        expect(h.requests).toHaveLength(3);
        expect(h.requests.map(r => (r.find(o => o.method === 'in')!.args[1] as string[]).length))
            .toEqual([100, 100, 50]);
        expect(byId.size).toBe(250);
        expect(byId.get(id(42))?.shift_date).toBe('2099-11-20');
    });

    it('throws when any chunk fails, so an unreadable shift is never treated as checked', async () => {
        const ids = Array.from({ length: 150 }, (_, i) => id(i));
        h.setQueue([page(0, 100), { data: null, error: { message: 'timeout' } }]);

        await expect(shiftsQueries.getPublishCheckRows(ids)).rejects.toThrow(/timeout/);
    });
});
