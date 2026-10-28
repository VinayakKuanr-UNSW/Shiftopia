import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/platform/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchEmployeeShiftsV2 } from '../employee-context';

/**
 * The swap, bid and assign modals load an employee's history through this one
 * function. It rebuilt each row field by field and dropped `paid_break_minutes`,
 * so `dailySpreadRule` measured a wider cl 39.2 spread than the DB trigger and
 * refused lawful split-shift days.
 */
describe('fetchEmployeeShiftsV2', () => {
    beforeEach(() => rpc.mockReset());

    it('carries paid rest breaks through to the V8 shift', async () => {
        rpc.mockResolvedValueOnce({
            data: [{
                id: 's1', shift_date: '2026-08-17', start_time: '06:00:00', end_time: '11:00:00',
                unpaid_break_minutes: 0, paid_break_minutes: 20, user_contract_id: null,
            }],
            error: null,
        });

        const [shift] = await fetchEmployeeShiftsV2('e1', '2026-08-17');

        expect(shift.paid_break_minutes).toBe(20);
    });

    it('rejects a refused read instead of passing it off as an empty roster', async () => {
        // An empty history makes every cumulative rule pass, so a refusal that
        // came back as [] turned "could not check" into "compliant".
        const refusal = { code: '42501', message: 'not authorised' };
        rpc.mockResolvedValueOnce({ data: null, error: refusal });

        const read = fetchEmployeeShiftsV2('e2', '2026-08-17');

        await expect(read).rejects.toThrow(/shift history for e2/);
        await expect(read).rejects.toMatchObject({ cause: refusal });
    });
});
