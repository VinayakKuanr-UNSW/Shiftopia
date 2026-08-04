import { describe, it, expect } from 'vitest';
import {
    formatShiftTime,
    formatShiftDate,
    getShiftDateKey,
    getShiftInstant,
    type ShiftTimeFields,
} from '../date.utils';

/**
 * These assertions must hold regardless of the process/browser timezone — the app
 * is Australian and every shift time renders in Australia/Sydney (AEST/AEDT).
 * Run this file with `TZ=Asia/Singapore` (UTC+8) to prove tz-independence.
 */
describe('canonical shift wall-clock (AEST/AEDT)', () => {
    // Authored naive time = 11:00–16:00 Sydney, but start_at is STALE/inconsistent
    // (encodes 09:00 Sydney). The naive fields must win — this is the exact
    // MyRoster(11:00) vs MySwaps(09:00) discrepancy.
    const staleShift = {
        shift_date: '2026-07-13',
        start_time: '11:00:00',
        end_time: '16:00:00',
        start_at: '2026-07-12T23:00:00Z', // 09:00 Sydney (AEST +10) — stale
        end_at: '2026-07-13T04:00:00Z',    // 14:00 Sydney — stale
        tz_identifier: 'Australia/Sydney',
    };

    it('prefers the authored naive start_time/end_time over a stale start_at/end_at', () => {
        expect(formatShiftTime(staleShift, 'start', 'HH:mm')).toBe('11:00');
        expect(formatShiftTime(staleShift, 'end', 'HH:mm')).toBe('16:00');
    });

    it('renders the shift date from the authored shift_date', () => {
        expect(formatShiftDate(staleShift, 'yyyy-MM-dd')).toBe('2026-07-13');
        expect(getShiftDateKey(staleShift)).toBe('2026-07-13');
    });

    it('ignores a non-Sydney tz_identifier for display (always AEST/AEDT)', () => {
        // Even if the row carried a bogus display tz, output stays Sydney wall-clock.
        // The cast is the point of the test: `tz_identifier` is deliberately NOT
        // part of `ShiftTimeFields`, because display timezone is never taken from
        // the row — it is always Australia/Sydney. Passing one anyway must change
        // nothing.
        const withBogusTz = { ...staleShift, tz_identifier: 'Asia/Singapore' } as ShiftTimeFields;
        expect(formatShiftTime(withBogusTz, 'start', 'HH:mm')).toBe('11:00');
    });

    it('falls back to start_at formatted in Sydney when naive fields are absent', () => {
        const atOnly = { start_at: '2026-07-12T23:00:00Z', end_at: '2026-07-13T04:00:00Z' };
        // 23:00Z + 10h (AEST) = 09:00 next day Sydney
        expect(formatShiftTime(atOnly, 'start', 'HH:mm')).toBe('09:00');
        expect(formatShiftTime(atOnly, 'end', 'HH:mm')).toBe('14:00');
    });

    it('honours DST: January is AEDT (+11)', () => {
        const summer = { shift_date: '2026-01-15', start_time: '09:00:00', end_time: '17:00:00' };
        expect(formatShiftTime(summer, 'start', 'HH:mm')).toBe('09:00');
        // start_at fallback: 22:00Z + 11h (AEDT) = 09:00 next day
        expect(formatShiftTime({ start_at: '2026-01-14T22:00:00Z' }, 'start', 'HH:mm')).toBe('09:00');
    });

    it('returns null / fallback when nothing usable is present', () => {
        expect(getShiftInstant(null, 'start')).toBeNull();
        expect(getShiftInstant({}, 'start')).toBeNull();
        expect(formatShiftTime({}, 'start', 'HH:mm', '—')).toBe('—');
        expect(getShiftDateKey({})).toBeUndefined();
    });
});
