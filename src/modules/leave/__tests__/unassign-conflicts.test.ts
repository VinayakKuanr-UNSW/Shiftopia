/**
 * Leave approval unassigns the part-time / casual shifts in the leave dates
 * through `sm_unassign_shift` — the roster's own command, so a Published
 * shift goes to Bidding exactly as when a manager removes someone on the
 * roster. These pin the contract: empty input short-circuits, the right RPC is
 * called once per shift, partial success is counted, errors are returned.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
  supabase: { rpc: (...args: any[]) => mockRpc(...args) },
}));

import { unassignConflictingShifts } from '../api/leave.api';

describe('unassignConflictingShifts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('short-circuits on empty input without calling the database', async () => {
    const res = await unassignConflictingShifts([]);
    expect(res.data).toEqual({ attempted: 0, succeeded: 0 });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('unassigns each shift through sm_unassign_shift (Published → Bidding)', async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    const res = await unassignConflictingShifts(['a', 'b']);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('sm_unassign_shift', { p_shift_id: 'a' });
    expect(res.data).toEqual({ attempted: 2, succeeded: 2 });
  });

  it('counts a refused shift as not unassigned, not as a failure of the batch', async () => {
    mockRpc.mockImplementation(async (_n: string, args: { p_shift_id: string }) =>
      ({ data: { success: args.p_shift_id === 'a' }, error: null }));
    const res = await unassignConflictingShifts(['a', 'b', 'c']);
    expect(res.data).toEqual({ attempted: 3, succeeded: 1 });
  });

  it('returns a database error as an error result, not a throw', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('network down') });
    const res = await unassignConflictingShifts(['a']);
    expect(res.error).toBe('network down');
  });
});
