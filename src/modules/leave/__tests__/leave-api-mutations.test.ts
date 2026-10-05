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

/**
 * Approval now DELETES the full-time shifts the leave collides with, so the
 * command is mocked and its calls asserted. A real `deleteShift` would go
 * through the `sm_delete_shift` RPC.
 */
const deleted = vi.hoisted(() => ({ ids: [] as string[], fail: new Set<string>() }));
vi.mock('@/modules/rosters/api/shifts.commands', () => ({
  shiftsCommands: {
    deleteShift: async (id: string) => {
      if (deleted.fail.has(id)) throw new Error('FSM guard refused the delete');
      deleted.ids.push(id);
      return true;
    },
  },
}));

import { createLeaveRequest, approveLeaveRequest, rejectLeaveRequest, revokeLeaveRequest } from '../api/leave.api';

const opsFor = (table: string, method: string) =>
  h.ops.filter((o) => o.table === table && o.method === method);

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
    h.enqueue({ data: [{ id: 'existing' }], error: null }); // overlap pre-check hit

    const res = await createLeaveRequest('e1', annualInput);

    expect(res.error).toMatch(/overlaps these dates/i);
    expect(res.data).toBeUndefined();
    expect(opsFor('leave_requests', 'insert')).toHaveLength(0); // never inserted
  });

  it('maps a 23P01 exclusion_violation from the DB constraint to the friendly error', async () => {
    h.enqueue(
      { data: [], error: null },                           // pre-check clear (race)
      { data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }, // insert
    );

    const res = await createLeaveRequest('e1', annualInput);

    expect(res.error).toMatch(/overlaps these dates/i);
    expect(opsFor('leave_requests', 'insert')).toHaveLength(1); // insert attempted
  });

  it('submits a request larger than the balance — leave in advance is the manager\'s call', async () => {
    // Decision 2026-09-30: no floor, the employee may submit, both are warned.
    h.enqueue(
      { data: [], error: null },                                       // overlap clear
      { data: { id: 'r9', employee_id: 'e1', status: 'pending' }, error: null }, // insert
    );

    const res = await createLeaveRequest('e1', { ...annualInput, requestedHours: 500 });

    expect(res.error).toBeUndefined();
    expect(opsFor('leave_requests', 'insert')).toHaveLength(1);
    // …and it never even reads the balance to refuse on.
    expect(opsFor('leave_balances', 'select')).toHaveLength(0);
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

/**
 * Approving leave clears the roster underneath it — but only for full-time.
 *
 * A full-time shift's hours are reconciled against a contracted cycle, and the
 * Office grid renders an approved leave day as closed to rostering, so a
 * full-time shift surviving under approved leave is an incoherent state that
 * would later mark the employee No-Show. Part-time and casual shifts are
 * coverage: who replaces them is a manager's decision, so those are still only
 * reported. Pinned because this is a DESTRUCTIVE change to a shared path.
 */
describe('approveLeaveRequest — clearing the roster underneath', () => {
  // Far future: a shift whose start has passed is never removed (see the
  // started-shift test), so "removable" fixtures must not age into the past.
  const conflictRow = (id: string, target: string | null, shiftDate = '2099-08-03') => ({
    id, shift_date: shiftDate, start_time: '08:00', end_time: '16:06',
    lifecycle_status: 'Draft', target_employment_type: target,
  });

  beforeEach(() => { deleted.ids.length = 0; deleted.fail.clear(); });

  it('deletes the full-time shifts and reports the rest', async () => {
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null },
      { data: [{ id: 'r1' }], error: null },
      {
        data: [
          conflictRow('ft-1', 'FT'),
          conflictRow('casual-1', 'Casual'),
          conflictRow('pt-1', 'PT'),
        ],
        error: null,
      },
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(deleted.ids).toEqual(['ft-1']);
    expect(res.data?.removedShifts.map(c => c.shiftId)).toEqual(['ft-1']);
    // The two that a manager still has to action, untouched.
    expect(res.data?.conflictingShifts.map(c => c.shiftId)).toEqual(['casual-1', 'pt-1']);
    expect(res.data?.removalFailures).toEqual([]);
  });

  it('NEVER deletes or unassigns a shift that was already worked', async () => {
    // Retro sick leave: the range covers a Completed, clocked-in FT shift and a
    // clocked-in casual one.
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null },
      { data: [{ id: 'r1' }], error: null },
      {
        data: [
          { ...conflictRow('ft-worked', 'FT'), lifecycle_status: 'Completed', actual_start: '2026-08-03T08:01:00+10:00' },
          { ...conflictRow('cas-clocked', 'Casual'), lifecycle_status: 'Published', actual_start: '2026-08-03T08:02:00+10:00' },
          conflictRow('ft-future', 'FT'),
        ],
        error: null,
      },
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(deleted.ids).toEqual(['ft-future']);
    expect(res.data?.keptWorked.map(c => c.shiftId)).toEqual(['ft-worked', 'cas-clocked']);
    expect(res.data?.conflictingShifts).toEqual([]); // the clocked-in casual shift is NOT sent to unassign
  });

  it('never deletes or unassigns a shift that has STARTED, even if nobody clocked in', async () => {
    // A past FT Draft (never worked) and a past casual one: started is enough.
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null },
      { data: [{ id: 'r1' }], error: null },
      {
        data: [
          conflictRow('ft-past', 'FT', '2020-01-06'),
          conflictRow('cas-past', 'Casual', '2020-01-06'),
          conflictRow('ft-future', 'FT'),
        ],
        error: null,
      },
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(deleted.ids).toEqual(['ft-future']);
    expect(res.data?.keptWorked.map(c => c.shiftId)).toEqual(['ft-past', 'cas-past']);
    expect(res.data?.conflictingShifts).toEqual([]);
  });

  it('reports a failed deletion instead of swallowing it', async () => {
    // The approval has already landed and cannot be rolled back from here, so a
    // failure has to surface — the shift is still rostered under approved leave.
    deleted.fail.add('ft-1');
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null },
      { data: [{ id: 'r1' }], error: null },
      { data: [conflictRow('ft-1', 'FT')], error: null },
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    // Approval still succeeded.
    expect(res.error).toBeUndefined();
    expect(res.data?.removedShifts).toEqual([]);
    expect(res.data?.removalFailures).toHaveLength(1);
    expect(res.data?.removalFailures[0].reason).toMatch(/FSM guard/);
  });

  it('treats a null employment target as not-full-time', async () => {
    // `target_employment_type` is NOT NULL in production, but a null arriving
    // from a join or an older row must not be deleted on a guess.
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1' }, error: null },
      { data: [{ id: 'r1' }], error: null },
      { data: [conflictRow('unknown-1', null)], error: null },
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(deleted.ids).toEqual([]);
    expect(res.data?.conflictingShifts.map(c => c.shiftId)).toEqual(['unknown-1']);
  });
});

describe('approveLeaveRequest — leave in advance', () => {
  it('approves past the balance, with no balance read to refuse on', async () => {
    // The trigger now records the deficit (no GREATEST(0, …) floor, no CHECK).
    h.enqueue(
      { data: { id: 'r1', status: 'pending', employee_id: 'e1', leave_type: 'annual', requested_hours: 500 }, error: null },
      { data: [{ id: 'r1' }], error: null }, // update → 1 row
      { data: [], error: null },             // conflicts
    );

    const res = await approveLeaveRequest('r1', 'mgr');

    expect(res.error).toBeUndefined();
    expect(opsFor('leave_requests', 'update')).toHaveLength(1);
    expect(opsFor('leave_balances', 'select')).toHaveLength(0);
  });
});

describe('rejectLeaveRequest', () => {
  it('requires a reason, and writes nothing without one', async () => {
    const res = await rejectLeaveRequest('r1', 'mgr', '   ');
    expect(res.error).toMatch(/reason/i);
    expect(opsFor('leave_requests', 'update')).toHaveLength(0);
  });

  it('stores the reason it was given, not a canned one', async () => {
    h.enqueue({ data: [{ id: 'r1' }], error: null });
    await rejectLeaveRequest('r1', 'mgr', 'Peak event week');
    const payload = opsFor('leave_requests', 'update')[0].args[0] as Record<string, unknown>;
    expect(payload.rejection_reason).toBe('Peak event week');
  });

  it('reports a request that was actioned in the meantime', async () => {
    h.enqueue({ data: [], error: null });
    expect((await rejectLeaveRequest('r1', 'mgr', 'x')).error).toMatch(/no longer pending/i);
  });
});

describe('revokeLeaveRequest', () => {
  it('moves only APPROVED, not-yet-ended leave to cancelled, keeping the reason', async () => {
    h.enqueue({ data: [{ id: 'r1' }], error: null });

    const res = await revokeLeaveRequest('r1', 'Event moved', '2026-10-01');

    expect(res.error).toBeUndefined();
    const payload = opsFor('leave_requests', 'update')[0].args[0] as Record<string, unknown>;
    expect(payload).toEqual({ status: 'cancelled', rejection_reason: 'Event moved' });
    // approved_by is NOT cleared — it is what marks this as a revocation.
    expect(payload).not.toHaveProperty('approved_by');
    expect(opsFor('leave_requests', 'eq').map(o => o.args)).toContainEqual(['status', 'approved']);
    expect(opsFor('leave_requests', 'gte').map(o => o.args)).toContainEqual(['end_date', '2026-10-01']);
  });

  it('says so when nothing matched (already ended, or not approved)', async () => {
    h.enqueue({ data: [], error: null });
    expect((await revokeLeaveRequest('r1', 'x', '2026-10-01')).error).toMatch(/not yet ended/);
  });

  it('requires a reason', async () => {
    expect((await revokeLeaveRequest('r1', '', '2026-10-01')).error).toMatch(/reason/i);
  });
});

