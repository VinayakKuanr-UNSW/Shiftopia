/**
 * leave.api mutation contract — pins the Phase 2/3 hardening of createLeaveRequest
 * and approveLeaveRequest without a live Supabase:
 *   - H5 overlap: the pre-check short-circuits before insert, and a 23P01
 *     exclusion_violation from the DB constraint maps to the same friendly error.
 *   - M1 approve guard: a zero-row UPDATE (status raced away from 'pending')
 *     surfaces an error instead of silently "succeeding"; self-approval is blocked.
 *
 * Network-free: the supabase client is mocked with a queue-driven chain proxy
 * (each awaited chain / .single() dequeues the next canned result).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type MockResult = { data?: unknown; error?: { message?: string; code?: string } | null };

const h = vi.hoisted(() => {
  const queue: MockResult[] = [];
  const ops: Array<{ table: string; method: string; args: unknown[] }> = [];
  const dequeue = (): MockResult => queue.shift() ?? { data: null, error: null };

  function makeChain(table: string): any {
    const chain: any = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') {
          return (res: any, rej: any) => Promise.resolve(dequeue()).then(res, rej);
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => { ops.push({ table, method: prop, args: [] }); return Promise.resolve(dequeue()); };
        }
        return (...args: unknown[]) => { ops.push({ table, method: prop, args }); return chain; };
      },
    });
    return chain;
  }

  const supabase = { from: (t: string) => makeChain(t) };
  return {
    queue, ops, supabase,
    enqueue: (...items: MockResult[]) => queue.push(...items),
    reset: () => { queue.length = 0; ops.length = 0; },
  };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: h.supabase }));
// leave.api imports shiftsCommands at module load (used only by unassign); stub it.
vi.mock('@/modules/rosters/api/shifts.commands', () => ({
  shiftsCommands: { bulkUnassignShifts: vi.fn() },
}));

import { createLeaveRequest, approveLeaveRequest } from '../api/leave.api';

const opsFor = (table: string, method: string) =>
  h.ops.filter((o) => o.table === table && o.method === method);

const balanceRow = (leaveType: string, hours: number) => ({
  id: 'b1', employee_id: 'e1', leave_type: leaveType,
  balance_hours: hours, accrued_hours: 0, used_hours: 0, as_of_date: '2026-01-01',
});

const annualInput = {
  leaveType: 'annual' as const,
  startDate: '2026-08-01',
  endDate: '2026-08-05',
  requestedHours: 10,
};

beforeEach(() => {
  h.reset();
  vi.clearAllMocks();
});

describe('createLeaveRequest — overlap guard (H5)', () => {
  it('rejects when the overlap pre-check finds a pending/approved request — no insert', async () => {
    h.enqueue(
      { data: [balanceRow('annual', 1000)], error: null }, // getLeaveBalances
      { data: [{ id: 'existing' }], error: null },          // overlap pre-check hit
    );

    const res = await createLeaveRequest('e1', annualInput);

    expect(res.error).toMatch(/overlaps these dates/i);
    expect(res.data).toBeUndefined();
    expect(opsFor('leave_requests', 'insert')).toHaveLength(0); // never inserted
  });

  it('maps a 23P01 exclusion_violation from the DB constraint to the friendly error', async () => {
    h.enqueue(
      { data: [balanceRow('annual', 1000)], error: null }, // getLeaveBalances
      { data: [], error: null },                           // pre-check clear (race)
      { data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }, // insert
    );

    const res = await createLeaveRequest('e1', annualInput);

    expect(res.error).toMatch(/overlaps these dates/i);
    expect(opsFor('leave_requests', 'insert')).toHaveLength(1); // insert attempted
  });

  it('rejects on insufficient balance before any overlap/insert work', async () => {
    h.enqueue({ data: [balanceRow('annual', 5)], error: null }); // 5h < 10h requested

    const res = await createLeaveRequest('e1', annualInput);

    expect(res.error).toMatch(/insufficient annual balance/i);
    expect(opsFor('leave_requests', 'insert')).toHaveLength(0);
  });
});

describe('approveLeaveRequest — status guard (M1)', () => {
  it('errors when the guarded UPDATE matches zero rows (already actioned)', async () => {
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null }, // fetch
      { data: [], error: null },                                                 // update → 0 rows
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(res.error).toMatch(/no longer pending/i);
  });

  it('succeeds (and reports conflicts) when the UPDATE matches a still-pending row', async () => {
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null }, // fetch
      { data: [{ id: 'r1' }], error: null },                                     // update → 1 row
      { data: [], error: null },                                                 // getLeaveShiftConflicts
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(res.error).toBeUndefined();
    expect(res.data?.conflictingShifts).toEqual([]);
  });

  it('blocks self-approval before any write', async () => {
    h.enqueue({ data: { id: 'r1', status: 'pending', employee_id: 'mgr' }, error: null }); // fetch

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(res.error).toMatch(/cannot approve your own/i);
    expect(opsFor('leave_requests', 'update')).toHaveLength(0);
  });
});
