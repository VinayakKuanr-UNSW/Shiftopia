import { describe, expect, it } from 'vitest';
import { resolveNetMinutes } from '../hours-compliance';

/**
 * The production shape, on all 336 rows: a 7.5h clock shift with a 45 minute
 * break of which 15 is a PAID rest pause, leaving 7h paid.
 *   scheduled 450 − unpaid 30 = net 420
 * Deducting the whole 45 would give 405 and underpay the rest pause.
 */
const PROD_ROW = {
    net_length_minutes: 420,
    scheduled_length_minutes: 450,
    unpaid_break_minutes: 30,
    start_time: '09:00',
    end_time: '16:30',
};

describe('resolveNetMinutes', () => {
    it('takes net_length_minutes, the column that IS the answer', () => {
        expect(resolveNetMinutes(PROD_ROW)).toBe(420);
    });

    it('ignores the other columns entirely when net is present', () => {
        expect(
            resolveNetMinutes({ ...PROD_ROW, scheduled_length_minutes: 9999, unpaid_break_minutes: 9999 }),
        ).toBe(420);
    });

    // The guard below only runs if the app's invariant broke — the schema
    // marks net_length_minutes nullable and defaults it to nothing.
    it('deducts ONLY the unpaid break when it has to fall back to gross', () => {
        expect(resolveNetMinutes({ ...PROD_ROW, net_length_minutes: null })).toBe(420);
    });

    it('does not deduct the paid rest pause', () => {
        // The Annual Shift Grid deducted the whole break here and got 405.
        expect(resolveNetMinutes({ ...PROD_ROW, net_length_minutes: null })).not.toBe(405);
    });

    it('derives from the clock when both minute columns are missing', () => {
        expect(
            resolveNetMinutes({
                net_length_minutes: null,
                scheduled_length_minutes: null,
                unpaid_break_minutes: 30,
                start_time: '09:00',
                end_time: '16:30',
            }),
        ).toBe(420);
    });

    it('handles an overnight shift through the shared wrap helper', () => {
        expect(
            resolveNetMinutes({
                start_time: '22:00',
                end_time: '06:00',
                unpaid_break_minutes: 30,
            }),
        ).toBe(450);
    });

    it('treats a missing unpaid break as zero rather than as NaN', () => {
        expect(
            resolveNetMinutes({ net_length_minutes: null, scheduled_length_minutes: 450 }),
        ).toBe(450);
    });

    it('returns 0 rather than NaN when the row says nothing usable', () => {
        expect(resolveNetMinutes({})).toBe(0);
        expect(resolveNetMinutes({ net_length_minutes: null })).toBe(0);
    });

    // A break longer than the shift is bad data, not negative pay.
    it('never returns a negative duration', () => {
        expect(
            resolveNetMinutes({ scheduled_length_minutes: 60, unpaid_break_minutes: 90 }),
        ).toBe(0);
    });

    it('tolerates a numeric column arriving as a string', () => {
        expect(resolveNetMinutes({ net_length_minutes: '420' as unknown as number })).toBe(420);
    });
});
