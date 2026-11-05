import { describe, expect, it } from 'vitest';
import { getSwapTimer } from '../EmployeeSwaps.page';

// A trade expires at shift start (fn_set_swap_expires_at), not four hours before.
describe('getSwapTimer', () => {
    const startAt = '2026-12-01T09:00:00Z';

    it('is still open two hours before the start', () => {
        expect(getSwapTimer(new Date('2026-12-01T07:00:00Z'), startAt)).toBe('Expires in 2h 0m');
    });

    it('expires at the start', () => {
        expect(getSwapTimer(new Date('2026-12-01T09:00:00Z'), startAt)).toBe('Expired');
    });
});
