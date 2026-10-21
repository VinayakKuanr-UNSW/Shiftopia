/**
 * Templates › Capture: a failed shift count is not "no shifts".
 */
import { describe, it, expect } from 'vitest';
import { captureBlockerFor } from '../RosterTemplatesDialog';

const ok = {
    subDepartmentId: 'sub-1',
    isRangeValid: true,
    nameError: null,
    trimmedName: 'Theatre pattern',
    captureCount: 12,
    countError: null,
};

describe('captureBlockerFor', () => {
    it('allows capture when everything is in order', () => {
        expect(captureBlockerFor(ok)).toBeNull();
    });

    it('reports a failed count as a failure, not as an empty range', () => {
        const msg = captureBlockerFor({ ...ok, captureCount: null, countError: 'timeout' });
        expect(msg).toMatch(/could not count the shifts in this range \(timeout\)/i);
        expect(msg).not.toMatch(/no shifts/i);
    });

    it('still says "no shifts" when the count really is zero', () => {
        expect(captureBlockerFor({ ...ok, captureCount: 0 })).toBe('No shifts in this range to capture');
    });

    it('keeps the earlier checks first', () => {
        expect(captureBlockerFor({ ...ok, subDepartmentId: null, countError: 'x' })).toBe('Select a single sub-department to capture from');
        expect(captureBlockerFor({ ...ok, trimmedName: '' })).toBe('Name the template');
    });
});
