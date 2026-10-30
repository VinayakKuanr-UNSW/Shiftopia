import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/platform/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fairnessLedgerQueries } from '../fairnessLedger.queries';

/**
 * The AutoScheduler asks for a ledger recompute after every Apply. The RPC is
 * org-wide and needs org.manage, so for a manager it is refused BY DESIGN —
 * the nightly job refreshes the ledger. That refusal used to surface as two
 * console errors on every successful manager Apply.
 */
describe('fairnessLedgerQueries.requestRecompute', () => {
    beforeEach(() => rpc.mockReset());

    it('treats the admin-only refusal (42501) as expected, not as a failure', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not authorised' } });

        await expect(fairnessLedgerQueries.requestRecompute('org', '2026-11-06')).resolves.toBe(0);
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('still throws on any other failure', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });

        await expect(fairnessLedgerQueries.requestRecompute('org', '2026-11-06')).rejects.toThrow(/boom/);
        error.mockRestore();
    });
});
