/**
 * A new roster shift may not start in the past — earlier today included.
 *
 * The Add Shift form checked the DATE only, so at 14:00 a 09:00 shift for
 * today saved, and the "In progress — read only" banner showed over a form
 * that was still editable. The database now refuses such a start
 * (trg_shift_not_started); the form must say so before the round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newShiftStartRefusal } from '../utils';

// 14:00 on Wed 28 Oct 2026 in Sydney (AEDT, UTC+11).
const NOW = new Date('2026-10-28T03:00:00Z');
const today = new Date(2026, 9, 28);
const yesterday = new Date(2026, 9, 27);

const create = { editMode: false, isTemplateMode: false };

describe('newShiftStartRefusal', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('refuses a new shift that started earlier today', () => {
        expect(newShiftStartRefusal({ ...create, date: today, startTime: '09:00' }))
            .toBe('This start time has already passed');
    });

    it('refuses a new shift on an earlier day', () => {
        expect(newShiftStartRefusal({ ...create, date: yesterday, startTime: '18:00' }))
            .toBe('This start time has already passed');
    });

    it('allows a new shift later today', () => {
        expect(newShiftStartRefusal({ ...create, date: today, startTime: '16:00' })).toBeNull();
    });

    it('leaves editing an existing shift to the read-only rules', () => {
        expect(newShiftStartRefusal({ editMode: true, isTemplateMode: false, date: today, startTime: '09:00' }))
            .toBeNull();
    });

    it('does not apply to a template shift, which has a weekday, not a date', () => {
        expect(newShiftStartRefusal({ editMode: false, isTemplateMode: true, date: today, startTime: '09:00' }))
            .toBeNull();
    });

    it('waits for a complete start time', () => {
        expect(newShiftStartRefusal({ ...create, date: today, startTime: '9:' })).toBeNull();
    });
});
