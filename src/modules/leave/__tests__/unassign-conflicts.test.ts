/**
 * Approval-sweep completion (audit E): once leave is approved, the manager can
 * unassign the still-rostered shifts in one click. `unassignConflictingShifts`
 * is a thin, audited wrapper over the shift-mutation gateway; these tests pin
 * its contract — empty-input short-circuit, success/partial-success counting,
 * and error surfacing — without a live Supabase.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

// The gateway is the only real dependency; mock it so the test never touches
// supabase or the RPC layer. `vi.hoisted` lets the (hoisted) mock factory point
// straight at the same spy the tests configure — no wrapper indirection.
const { bulkUnassignShifts } = vi.hoisted(() => ({ bulkUnassignShifts: vi.fn() }));
vi.mock('@/modules/rosters/api/shifts.commands', () => ({
  shiftsCommands: { bulkUnassignShifts },
}));
// leave.api pulls in the supabase client at module load; stub it out.
vi.mock('@/platform/supabase/client', () => ({ supabase: {} }));

import { unassignConflictingShifts } from '../api/leave.api';

// Reset AFTER each test (not before). A resolved-value test primes tinyspy's
// promise tracker; if that state survives into the later throwing test, vitest
// 4 spuriously reports the (handled) throw as an unhandled error. Clearing the
// spy at the end of each test lets the throw test start from a pristine tracker.
afterEach(() => bulkUnassignShifts.mockReset());

describe('unassignConflictingShifts', () => {
  it('short-circuits on empty input WITHOUT calling the gateway', async () => {
    const res = await unassignConflictingShifts([]);
    expect(res.data).toEqual({ attempted: 0, succeeded: 0 });
    expect(bulkUnassignShifts).not.toHaveBeenCalled();
  });

  it('reports full success when every shift unassigns', async () => {
    bulkUnassignShifts.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const res = await unassignConflictingShifts(['a', 'b']);
    expect(bulkUnassignShifts).toHaveBeenCalledWith(['a', 'b']);
    expect(res.data).toEqual({ attempted: 2, succeeded: 2 });
  });

  it('reports partial success when the gateway skips some shifts', async () => {
    // e.g. one shift was reassigned/cancelled by another user (version conflict)
    // — the gateway returns only the rows it actually unassigned.
    bulkUnassignShifts.mockResolvedValue([{ id: 'a' }]);
    const res = await unassignConflictingShifts(['a', 'b', 'c']);
    expect(res.data).toEqual({ attempted: 3, succeeded: 1 });
  });

  it('surfaces a gateway throw as an error result, not a throw', async () => {
    bulkUnassignShifts.mockImplementation(async () => {
      throw new Error('network down');
    });
    const res = await unassignConflictingShifts(['a']);
    expect(res.error).toBe('network down');
    expect(res.data).toBeUndefined();
  });
});
