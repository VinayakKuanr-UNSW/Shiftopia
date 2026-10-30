import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rolling back a synthesis run must actually remove its unassigned shifts.
 *
 * It used to "soft-delete" them with `update({ deleted_at })`, but CHECK
 * shifts_no_soft_delete keeps deleted_at NULL on every shift, so the database
 * refused every row: each shift came back in `failedDeletes` and stayed on the
 * roster. They now go through the roster's guarded bulk delete
 * (sm_bulk_delete_shifts — authority check, refuses started/worked shifts).
 */

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];

function builder(table: string) {
    let op = 'select';
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'delete', 'eq', 'in', 'is']) {
        chain[m] = (...args: unknown[]) => {
            if (m === 'select' || m === 'update' || m === 'delete') op = m;
            calls.push({ table, op: m, args });
            return chain;
        };
    }
    chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'shifts' && op === 'select') {
            return resolve({ data: [{ id: 'free', assigned_employee_id: null }, { id: 'taken', assigned_employee_id: 'emp-1' }], error: null });
        }
        if (table === 'shifts' && op === 'update') {
            return resolve({ data: null, count: null, error: { message: 'new row for relation "shifts" violates check constraint "shifts_no_soft_delete"' } });
        }
        return resolve({ data: null, count: 0, error: null });
    };
    return chain;
}

vi.mock('@/platform/supabase/client', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('@/platform/supabase/rpc/client', () => ({ requireUser: async () => ({ id: 'manager-1' }) }));
const bulkDelete = vi.fn(async (ids: string[]) => ({ deletedIds: ids, failed: [] }));
vi.mock('../shifts.commands', () => ({ shiftsCommands: { bulkDeleteShiftsPerItem: (ids: string[]) => bulkDelete(ids) } }));

import { synthesisRunsQueries } from '../synthesisRuns.queries';

describe('synthesisRunsQueries.rollbackRun', () => {
    beforeEach(() => { calls.length = 0; bulkDelete.mockClear(); });

    it('deletes the run\'s unassigned shifts through the guarded bulk delete', async () => {
        const result = await synthesisRunsQueries.rollbackRun('run-1');

        expect(bulkDelete).toHaveBeenCalledWith(['free']);
        expect(result.deletedCount).toBe(1);
        expect(result.failedDeletes).toEqual([]);
        expect(result.skippedAssigned).toBe(1);
    });

    it('never tries to soft-delete a shift', async () => {
        await synthesisRunsQueries.rollbackRun('run-1');

        expect(calls.some(c => c.table === 'shifts' && c.op === 'update')).toBe(false);
    });
});
