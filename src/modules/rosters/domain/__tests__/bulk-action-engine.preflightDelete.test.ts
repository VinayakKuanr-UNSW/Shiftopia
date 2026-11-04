import { describe, expect, it } from 'vitest';
import { preflightDelete } from '../bulk-action-engine';
import type { Shift } from '../shift.entity';

const shift = (id: string, lifecycle_status: string, is_cancelled = false) =>
    ({ id, lifecycle_status, is_cancelled }) as unknown as Shift;

describe('preflightDelete (03-bidding-fsm.md B-D13)', () => {
    it('deletes drafts and blocks published shifts, which are cancelled instead', () => {
        const result = preflightDelete([shift('d1', 'Draft'), shift('p1', 'Published'), shift('d2', 'Draft')]);
        expect(result.eligibleIds).toEqual(['d1', 'd2']);
        expect(result.blocked).toEqual([{ id: 'p1', reason: 'Published — cancel it instead' }]);
    });
});
