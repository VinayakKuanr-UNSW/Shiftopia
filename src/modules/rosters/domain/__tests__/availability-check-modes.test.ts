/**
 * The OPT_IN / OPT_OUT split in the manual-path availability check.
 *
 * These are the soft half of a pair. `optimizer-service/tests/test_ft_availability.py`
 * asserts the same facts against `employee_eligible()` — the HARD reading the
 * auto-scheduler applies. If one side changes without the other, a manager sees a
 * warning the solver disagrees with (or, worse, no warning where it does).
 */

import { describe, it, expect } from 'vitest';
import {
    availabilityModeForEmploymentStatus,
    evaluateShiftAvailability,
    evaluateShiftAvailabilityFromSlots,
} from '../availability-check';
import type { EmployeeAvailability } from '../availabilityResolution.types';

const D = '2026-07-08';

function avail(partial: Partial<EmployeeAvailability>): EmployeeAvailability {
    return {
        employeeId: 'e1',
        date: D,
        availableWindows: [],
        unavailableWindows: [],
        isFullyAvailable: false,
        isFullyUnavailable: false,
        hasData: true,
        ...partial,
    };
}

describe('availabilityModeForEmploymentStatus', () => {
    it('puts contract-obligated staff on OPT_OUT in every spelling', () => {
        for (const s of ['Full-Time', 'full time', 'FT', 'Part-Time', 'PT', 'Flexible Part-Time']) {
            expect(availabilityModeForEmploymentStatus(s)).toBe('OPT_OUT');
        }
    });

    it('puts casuals on OPT_IN, including the uppercase token the roster reader emits', () => {
        expect(availabilityModeForEmploymentStatus('Casual')).toBe('OPT_IN');
        expect(availabilityModeForEmploymentStatus('CASUAL')).toBe('OPT_IN');
    });

    // The strict reading is the safe one: it over-warns (visible, correctable)
    // rather than silently suppressing a real warning.
    it('falls back to OPT_IN for an unreadable status', () => {
        expect(availabilityModeForEmploymentStatus(null)).toBe('OPT_IN');
        expect(availabilityModeForEmploymentStatus('')).toBe('OPT_IN');
        expect(availabilityModeForEmploymentStatus('Contractor')).toBe('OPT_IN');
    });
});

describe('evaluateShiftAvailability — OPT_OUT (FT/PT)', () => {
    it('reads an absent declaration as contract-available, not as a warning', () => {
        const r = evaluateShiftAvailability(null, '09:00', '17:00', 'OPT_OUT');
        expect(r.verdict).toBe('contract_available');
        expect(r.isWarning).toBe(false);
        expect(r.message).toBe('');
    });

    it('reads hasData:false the same way', () => {
        const r = evaluateShiftAvailability(avail({ hasData: false }), '09:00', '17:00', 'OPT_OUT');
        expect(r.verdict).toBe('contract_available');
        expect(r.isWarning).toBe(false);
    });

    // The counter-intuitive half, and the one that makes OPT_OUT safe: a
    // declaration NARROWS the day rather than enabling it.
    it('still warns when a declaration exists and the shift falls outside it', () => {
        const r = evaluateShiftAvailability(
            avail({ availableWindows: [{ start: '09:00', end: '12:00' }] }),
            '09:00', '17:00', 'OPT_OUT',
        );
        expect(r.verdict).toBe('outside_window');
        expect(r.isWarning).toBe(true);
    });

    it('passes a shift contained by a declaration', () => {
        const r = evaluateShiftAvailability(
            avail({ availableWindows: [{ start: '08:00', end: '18:00' }] }),
            '09:00', '17:00', 'OPT_OUT',
        );
        expect(r.verdict).toBe('available');
        expect(r.isWarning).toBe(false);
    });

    // Absence is reinterpreted; an explicit marker never is. Unavailability under
    // OPT_OUT has to be stated positively, and this is what honours that.
    it('warns on an explicit fully-unavailable marker', () => {
        const r = evaluateShiftAvailability(
            avail({ isFullyUnavailable: true }), '09:00', '17:00', 'OPT_OUT',
        );
        expect(r.verdict).toBe('outside_window');
        expect(r.isWarning).toBe(true);
    });
});

describe('evaluateShiftAvailability — default mode', () => {
    it('defaults to OPT_IN, so existing callers keep the strict reading', () => {
        expect(evaluateShiftAvailability(null, '09:00', '17:00').verdict).toBe('no_availability');
        expect(evaluateShiftAvailability(null, '09:00', '17:00').isWarning).toBe(true);
    });
});

describe('evaluateShiftAvailabilityFromSlots — modes', () => {
    // The only branch that ever runs for an FT: after
    // 20260817120000_ft_availability_removal they hold no slots at all.
    it('reads an empty slot list as contract-available under OPT_OUT', () => {
        const r = evaluateShiftAvailabilityFromSlots([], D, '09:00:00', '17:00:00', 'OPT_OUT');
        expect(r.verdict).toBe('contract_available');
        expect(r.isWarning).toBe(false);
    });

    it('warns on an empty slot list under OPT_IN', () => {
        const r = evaluateShiftAvailabilityFromSlots([], D, '09:00:00', '17:00:00', 'OPT_IN');
        expect(r.verdict).toBe('no_availability');
        expect(r.isWarning).toBe(true);
    });

    it('ignores slots dated other than the shift date under OPT_OUT', () => {
        const r = evaluateShiftAvailabilityFromSlots(
            [{ slot_date: '2026-07-09', start_time: '09:00:00', end_time: '17:00:00' }],
            D, '09:00:00', '17:00:00', 'OPT_OUT',
        );
        expect(r.verdict).toBe('contract_available');
    });

    it('narrows the day when a slot exists for it, even under OPT_OUT', () => {
        const r = evaluateShiftAvailabilityFromSlots(
            [{ slot_date: D, start_time: '09:00:00', end_time: '12:00:00' }],
            D, '09:00:00', '17:00:00', 'OPT_OUT',
        );
        expect(r.verdict).toBe('outside_window');
        expect(r.isWarning).toBe(true);
    });

    it('defaults to OPT_IN', () => {
        expect(evaluateShiftAvailabilityFromSlots([], D, '09:00', '17:00').verdict)
            .toBe('no_availability');
    });
});
