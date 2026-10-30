import { describe, it, expect } from 'vitest';
import { validateBillableEdit } from '../billable-edit';

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

    // EBA minimum engagement (F-locked 2026-07-28): a manager cannot save
    // billable times that net less than the statutory minimum for this shift.
    describe('EBA minimum-engagement floor', () => {
        it('rejects an edit that nets below the required minimum', () => {
            const r = validateBillableEdit({
                editedStart: '14:00', editedEnd: '15:00', initialStart: '14:00', initialEnd: '21:30',
                scheduledStart: '14:00', scheduledEnd: '21:30', unpaidBreakMinutes: 0,
                requiredMinutes: 180, // 3h standard-day floor
            });
            expect(r.ok).toBe(false);
            expect(r.error).toMatch(/minimum engagement/i);
        });

        it('accepts an edit that nets exactly the required minimum', () => {
            const r = validateBillableEdit({
                editedStart: '14:00', editedEnd: '17:00', initialStart: '14:00', initialEnd: '21:30',
                scheduledStart: '14:00', scheduledEnd: '21:30', unpaidBreakMinutes: 0,
                requiredMinutes: 180,
            });
            expect(r.ok).toBe(true);
        });

        it('accepts an edit netting below 3h when the lower training floor applies', () => {
            // 14:00-16:00 = 2h net: fails the 3h standard floor but satisfies
            // the 2h training floor for the same duration.
            const r = validateBillableEdit({
                editedStart: '14:00', editedEnd: '16:00', initialStart: '14:00', initialEnd: '16:00',
                scheduledStart: '14:00', scheduledEnd: '16:00', unpaidBreakMinutes: 0,
                requiredMinutes: 120, // 2h training floor
            });
            expect(r.ok).toBe(true);
        });

        it('is a no-op when requiredMinutes is omitted (no-show/cancelled)', () => {
            const r = validateBillableEdit({ ...clean, editedEnd: '10:00' });
            expect(r.ok).toBe(true);
        });
    });

    describe('actual meal break window', () => {
        it('accepts a valid actual break between 30 and 60 minutes inside the shift', () => {
            const r = validateBillableEdit({
                ...clean,
                actualBreakStart: '13:00',
                actualBreakEnd: '13:30',
                rosteredBreakStart: '13:00',
                rosteredBreakEnd: '13:30',
            });
            expect(r.ok).toBe(true);
            expect(r.normalizedBreakStart).toBe('13:00');
            expect(r.normalizedBreakEnd).toBe('13:30');
            expect(r.hasBreakVarianceFlag).toBe(false);
        });

        it('rejects an actual break shorter than 30 minutes', () => {
            const r = validateBillableEdit({
                ...clean,
                actualBreakStart: '13:00',
                actualBreakEnd: '13:20',
            });
            expect(r.ok).toBe(false);
            expect(r.error).toMatch(/between 30 and 60 minutes/i);
        });

        it('rejects an actual break longer than 60 minutes', () => {
            const r = validateBillableEdit({
                ...clean,
                actualBreakStart: '13:00',
                actualBreakEnd: '14:15',
            });
            expect(r.ok).toBe(false);
            expect(r.error).toMatch(/between 30 and 60 minutes/i);
        });

        it('rejects an actual break outside the shift span', () => {
            const r = validateBillableEdit({
                ...clean,
                editedStart: '09:00',
                editedEnd: '17:00',
                actualBreakStart: '17:30',
                actualBreakEnd: '18:00',
            });
            expect(r.ok).toBe(false);
            expect(r.error).toMatch(/fall within/i);
        });

        it('flags when actual break deviates > 15 minutes from rostered break', () => {
            const r = validateBillableEdit({
                ...clean,
                actualBreakStart: '14:00',
                actualBreakEnd: '14:30',
                rosteredBreakStart: '12:00',
                rosteredBreakEnd: '12:30',
            });
            expect(r.ok).toBe(true);
            expect(r.hasBreakVarianceFlag).toBe(true);
            expect(r.breakVarianceMinutes).toBe(120);
        });
    });
});
