import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shiftsCommands } from '../shifts.commands';

const mockCallAuthenticatedRpc = vi.fn();

vi.mock('@/platform/supabase/rpc/client', () => ({
    callAuthenticatedRpc: (...args: any[]) => mockCallAuthenticatedRpc(...args),
    callRpc: vi.fn(),
    requireUser: vi.fn().mockResolvedValue('user-123'),
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {},
}));

describe('shiftsCommands.cancelShift', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns false for invalid UUIDs without invoking RPC', async () => {
        expect(await shiftsCommands.cancelShift('', 'reason')).toBe(false);
        expect(await shiftsCommands.cancelShift('not-a-uuid', 'reason')).toBe(false);
        expect(mockCallAuthenticatedRpc).not.toHaveBeenCalled();
    });

    it('calls sm_cancel_shift and returns true on success', async () => {
        const shiftId = '11111111-1111-1111-1111-111111111111';
        mockCallAuthenticatedRpc.mockResolvedValueOnce({
            success: true,
            from_state: 'S4',
            to_state: 'S10',
        });

        const res = await shiftsCommands.cancelShift(shiftId, 'Client requested cancellation', 3);
        expect(res).toBe(true);
        expect(mockCallAuthenticatedRpc).toHaveBeenCalledWith(
            'sm_cancel_shift',
            expect.any(Function),
            expect.anything(),
        );

        // Verify parameter payload generator
        const argGen = mockCallAuthenticatedRpc.mock.calls[0][1];
        expect(argGen('caller-id')).toEqual({
            p_shift_id: shiftId,
            p_reason: 'Client requested cancellation',
            p_expected_version: 3,
        });
    });

    it('throws with attached error code on RPC rejection', async () => {
        const shiftId = '11111111-1111-1111-1111-111111111111';
        mockCallAuthenticatedRpc.mockResolvedValueOnce({
            success: false,
            code: 'SHIFT_WORKED',
            error: 'Someone has clocked in to this shift.',
        });

        await expect(
            shiftsCommands.cancelShift(shiftId, 'Cancelled', 1),
        ).rejects.toThrow('Someone has clocked in to this shift.');

        mockCallAuthenticatedRpc.mockResolvedValueOnce({
            success: false,
            code: 'REASON_REQUIRED',
            error: 'Say why the shift is cancelled.',
        });
        await expect(shiftsCommands.cancelShift(shiftId, '')).rejects.toMatchObject({
            code: 'REASON_REQUIRED',
            message: 'Say why the shift is cancelled.',
        });
    });
});

