/**
 * Approval-sweep completion (audit E): once leave is approved, the manager can
 * unassign the still-rostered shifts in one click. `unassignConflictingShifts`
 * is a thin, audited wrapper over the shift-mutation gateway; these tests pin
 * its contract — empty-input short-circuit, success/partial-success counting,
 * and error surfacing — without a live Supabase.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => ({
          is: mockSelect,
        }),
      }),
    }),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

import { unassignConflictingShifts } from '../api/leave.api';

describe('unassignConflictingShifts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits on empty input WITHOUT calling the gateway', async () => {
    const res = await unassignConflictingShifts([]);
    expect(res.data).toEqual({ attempted: 0, succeeded: 0 });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('reports full success when every shift unassigns', async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { id: 'a', version: 1, assigned_employee_id: 'emp-1' },
        { id: 'b', version: 2, assigned_employee_id: 'emp-1' },
      ],
      error: null,
    });
    mockRpc.mockResolvedValue({ data: { code: 'APPLIED' }, error: null });

    const res = await unassignConflictingShifts(['a', 'b']);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(res.data).toEqual({ attempted: 2, succeeded: 2 });
  });

  it('reports partial success when the gateway skips some shifts', async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { id: 'a', version: 1, assigned_employee_id: 'emp-1' },
        { id: 'b', version: 2, assigned_employee_id: 'emp-1' },
        { id: 'c', version: 1, assigned_employee_id: 'emp-1' },
      ],
      error: null,
    });
    mockRpc.mockImplementation(async (_rpcName: string, args: { p_shift_id: string }) => {
      if (args.p_shift_id === 'a') return { data: { code: 'APPLIED' }, error: null };
      return { data: { code: 'VERSION_CONFLICT' }, error: null };
    });

    const res = await unassignConflictingShifts(['a', 'b', 'c']);
    expect(res.data).toEqual({ attempted: 3, succeeded: 1 });
  });

  it('surfaces a gateway throw as an error result, not a throw', async () => {
    mockSelect.mockRejectedValueOnce(new Error('network down'));

    const res = await unassignConflictingShifts(['a']);
    expect(res.error).toBe('network down');
    expect(res.data).toBeUndefined();
  });
});
