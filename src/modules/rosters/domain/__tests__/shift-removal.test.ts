import { describe, expect, it } from 'vitest';
import { getShiftRemoval } from '../shift-removal';

describe('getShiftRemoval (03-bidding-fsm.md B-D13)', () => {
    it('a draft is deleted', () => {
        expect(getShiftRemoval({ lifecycle_status: 'Draft' })).toBe('delete');
    });

    it.each(['Published', 'InProgress'])('a %s shift is cancelled, never deleted', lifecycle_status => {
        expect(getShiftRemoval({ lifecycle_status })).toBe('cancel');
    });

    it.each([
        { lifecycle_status: 'Cancelled' },
        { lifecycle_status: 'Completed' },
        { lifecycle_status: 'Published', is_cancelled: true },
    ])('a final shift offers neither (%o)', shift => {
        expect(getShiftRemoval(shift)).toBeNull();
    });
});
