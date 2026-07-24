import { describe, it, expect } from 'vitest';
import { validateBillableEdit, billableVarianceVsRoster } from '../billable-edit';

const sched = { scheduledStart: '09:00', scheduledEnd: '17:00' };
const clean = {
    editedStart: '09:00', editedEnd: '17:00',
    initialStart: '09:00', initialEnd: '17:00',
    ...sched, unpaidBreakMinutes: 30,
};

describe('validateBillableEdit', () => {
    it('accepts a clean on-roster edit (no reasons needed)', () => {
        const r = validateBillableEdit(clean);
        expect(r.ok).toBe(true);
        expect(r.needArrivalReason).toBe(false);
        expect(r.needDepartureReason).toBe(false);
    });

    it('auto-formats HHMM and normalizes', () => {
        const r = validateBillableEdit({ ...clean, editedStart: '900', editedEnd: '1700' });
        expect(r.ok).toBe(true);
        expect(r.normalizedStart).toBe('09:00');
        expect(r.normalizedEnd).toBe('17:00');
    });

    it('rejects non-5-minute increments', () => {
        expect(validateBillableEdit({ ...clean, editedStart: '09:07', initialStart: '09:00' }).ok).toBe(false);
        expect(validateBillableEdit({ ...clean, editedStart: '09:07' }).error).toMatch(/5-minute/);
    });

    it('rejects an unparseable time', () => {
        expect(validateBillableEdit({ ...clean, editedEnd: 'abc' }).ok).toBe(false);
    });

    it('treats an end before the start as an overnight shift (valid)', () => {
        // 22:00 → 06:00 wraps to +24h → 8h gross, valid.
        const r = validateBillableEdit({
            editedStart: '22:00', editedEnd: '06:00', initialStart: '22:00', initialEnd: '06:00',
            scheduledStart: '22:00', scheduledEnd: '06:00', unpaidBreakMinutes: 30,
        });
        expect(r.ok).toBe(true);
    });

    it('rejects an unpaid break longer than the worked window', () => {
        const r = validateBillableEdit({ ...clean, unpaidBreakMinutes: 9 * 60 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/exceeds/);
    });

    it('requires a reason only on a CHANGED side that varies beyond grace', () => {
        // Start moved 09:00 → 09:30 (30m late), end untouched.
        const r = validateBillableEdit({ ...clean, editedStart: '09:30', initialStart: '09:00' });
        expect(r.ok).toBe(true);
        expect(r.needArrivalReason).toBe(true);
        expect(r.needDepartureReason).toBe(false);
    });

    it('does not require a reason for a within-grace change', () => {
        const r = validateBillableEdit({ ...clean, editedStart: '09:05', initialStart: '09:00' });
        expect(r.needArrivalReason).toBe(false);
    });

    it('does not require a reason for an unchanged varying side', () => {
        // End is 30m over but the manager only touched the start (which is on-roster).
        const r = validateBillableEdit({ ...clean, editedStart: '09:00', editedEnd: '17:30', initialEnd: '17:30' });
        expect(r.needDepartureReason).toBe(false);
    });
});

describe('billableVarianceVsRoster (approval gate)', () => {
    it('flags a billable window that varies from roster', () => {
        expect(billableVarianceVsRoster('09:00', '17:45', '09:00', '17:00'))
            .toEqual({ arrival: false, departure: true });
        expect(billableVarianceVsRoster('08:30', '17:00', '09:00', '17:00'))
            .toEqual({ arrival: true, departure: false });
    });

    it('is clean when on-roster within grace', () => {
        expect(billableVarianceVsRoster('09:03', '16:58', '09:00', '17:00'))
            .toEqual({ arrival: false, departure: false });
    });

    it('yields no variance for a missing billable side', () => {
        expect(billableVarianceVsRoster('09:00', null, '09:00', '17:00'))
            .toEqual({ arrival: false, departure: false });
    });
});
