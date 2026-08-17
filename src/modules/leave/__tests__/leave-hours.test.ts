/**
 * Derived leave hours.
 *
 * `requestedHours` was a free numeric input the employee typed, and it is the
 * number `createLeaveRequest` checks against the balance and the DB trigger
 * deducts. So a typo drew down a statutory entitlement and a 0 drew down
 * nothing. These pin the rules that replace it.
 */

import { describe, expect, it } from 'vitest';
import {
    eachDateInclusive,
    resolveRequestedLeaveHours,
    type LeaveHoursShift,
} from '../domain/leave-hours';

const FT_WEEK = 38;
const PT_WEEK = 20;

// 2026-03-02 is a Monday; 2026-03-08 the Sunday that ends the ISO week.
const MON = '2026-03-02';
const FRI = '2026-03-06';
const SUN = '2026-03-08';

const shift = (o: Partial<LeaveHoursShift> & { shiftDate: string }): LeaveHoursShift => ({
    startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 30, ...o,
});

describe('eachDateInclusive', () => {
    it('is inclusive at both ends', () => {
        expect(eachDateInclusive(MON, '2026-03-04')).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    });

    it('handles a single day', () => {
        expect(eachDateInclusive(MON, MON)).toEqual([MON]);
    });

    it('crosses a month boundary', () => {
        expect(eachDateInclusive('2026-02-27', '2026-03-02')).toEqual([
            '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
        ]);
    });

    it('returns nothing for a reversed or unparseable range', () => {
        expect(eachDateInclusive('2026-03-08', MON)).toEqual([]);
        expect(eachDateInclusive('not-a-date', MON)).toEqual([]);
    });
});

describe('resolveRequestedLeaveHours — contract basis', () => {
    it('charges a full-timer 7.6h per working day', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: FRI,
            contractedWeeklyHours: FT_WEEK, rosteredShifts: [],
        });
        expect(r.basis).toBe('contract');
        expect(r.daysCounted).toBe(5);
        expect(r.hours).toBe(38);
    });

    it('does not charge for the weekend inside a range', () => {
        // Mon-Sun is 7 calendar days but only 5 working ones. The old free-text
        // field had no idea; a user typing "7 days x 7.6" over-consumed by 15.2h.
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: SUN,
            contractedWeeklyHours: FT_WEEK, rosteredShifts: [],
        });
        expect(r.daysCounted).toBe(5);
        expect(r.hours).toBe(38);
    });

    it('derives the daily rate from the contract\'s OWN week, not a flat 5 days', () => {
        // A part-timer on 20h across 3 days works a 6.67h day. Dividing by 5
        // would consume 4h/day and under-draw their balance by a third.
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: '2026-03-04',
            contractedWeeklyHours: PT_WEEK, ordinaryDays: [1, 2, 3],
            rosteredShifts: [],
        });
        expect(r.daysCounted).toBe(3);
        expect(r.hours).toBeCloseTo(20, 6);
    });

    it('only counts days inside the contract\'s ordinary days', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: SUN,
            contractedWeeklyHours: PT_WEEK, ordinaryDays: [6, 7], // weekend-only contract
            rosteredShifts: [],
        });
        expect(r.daysCounted).toBe(2);
        expect(r.hours).toBeCloseTo(20, 6);
    });

    it('never consumes leave on a public holiday', () => {
        // 2026-01-26 is a Monday (Australia Day). Mon-Fri that week is 5
        // weekdays but only 4 consume leave.
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: '2026-01-26', endDate: '2026-01-30',
            contractedWeeklyHours: FT_WEEK, rosteredShifts: [],
        });
        expect(r.publicHolidaysSkipped).toContain('2026-01-26');
        expect(r.daysCounted).toBe(4);
        expect(r.hours).toBeCloseTo(30.4, 6);
        expect(r.explanation).toMatch(/public holiday/);
    });

    it('returns zero for a range with no working days at all', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: '2026-03-07', endDate: SUN, // Sat-Sun
            contractedWeeklyHours: FT_WEEK, rosteredShifts: [],
        });
        expect(r.hours).toBe(0);
        expect(r.basis).toBe('no-working-days');
    });
});

describe('resolveRequestedLeaveHours — rostered basis', () => {
    it('prefers the real roster over the contract estimate', () => {
        // Two 7.5h shifts (8h gross less a 30m unpaid break) = 15h, not the
        // 15.2h the contract would have estimated for two days.
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: '2026-03-03',
            contractedWeeklyHours: FT_WEEK,
            rosteredShifts: [shift({ shiftDate: MON }), shift({ shiftDate: '2026-03-03' })],
        });
        expect(r.basis).toBe('rostered');
        expect(r.hours).toBe(15);
        expect(r.daysCounted).toBe(2);
    });

    it('deducts only the UNPAID break, leaving the paid rest pause in', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: MON,
            contractedWeeklyHours: FT_WEEK,
            rosteredShifts: [shift({ shiftDate: MON, startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 30 })],
        });
        expect(r.hours).toBe(7.5);
    });

    it('handles an overnight shift', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: MON,
            contractedWeeklyHours: FT_WEEK,
            rosteredShifts: [shift({ shiftDate: MON, startTime: '22:00', endTime: '06:00', unpaidBreakMinutes: 0 })],
        });
        expect(r.hours).toBe(8);
    });

    it('DOES consume leave for a shift rostered on a public holiday', () => {
        // The holiday skip belongs to the contract estimate only. A rostered
        // public-holiday shift is work, and leave covering it draws down.
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: '2026-01-26', endDate: '2026-01-26',
            contractedWeeklyHours: FT_WEEK,
            rosteredShifts: [shift({ shiftDate: '2026-01-26' })],
        });
        expect(r.basis).toBe('rostered');
        expect(r.hours).toBe(7.5);
    });

    it('treats an EMPTY roster array as "looked, found none" and estimates', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: MON,
            contractedWeeklyHours: FT_WEEK, rosteredShifts: [],
        });
        expect(r.basis).toBe('contract');
    });

    it('ignores a shift with no times rather than counting it as a full day', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: MON,
            contractedWeeklyHours: FT_WEEK,
            rosteredShifts: [shift({ shiftDate: MON, startTime: null, endTime: null })],
        });
        expect(r.hours).toBe(0);
    });
});

describe('resolveRequestedLeaveHours — casuals', () => {
    it('consumes nothing for a leave type casuals do not accrue', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: FRI,
            contractedWeeklyHours: undefined, rosteredShifts: [],
        });
        expect(r.hours).toBe(0);
        expect(r.basis).toBe('unpaid-for-casual');
        expect(r.explanation).toMatch(/records the absence/);
    });

    it('pays a casual for FDV against their rostered shifts (cl 46 / NES Div 11)', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'fdv', startDate: MON, endDate: MON,
            contractedWeeklyHours: undefined,
            rosteredShifts: [shift({ shiftDate: MON })],
        });
        expect(r.basis).toBe('rostered');
        expect(r.hours).toBe(7.5);
    });

    it('does not invent a permanent\'s day for a casual with no roster', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'fdv', startDate: MON, endDate: MON,
            contractedWeeklyHours: undefined, rosteredShifts: [],
        });
        expect(r.hours).toBe(0);
        expect(r.basis).toBe('no-working-days');
        expect(r.explanation).toMatch(/once the roster is published/);
    });

    it('treats a zero weekly basis as no obligation', () => {
        // Casual rows carry contracted_weekly_hours = 0 in production; 0 is
        // "unset", never "a zero-hour contract to divide by".
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: MON, endDate: FRI,
            contractedWeeklyHours: 0, rosteredShifts: [],
        });
        expect(r.hours).toBe(0);
        expect(r.basis).toBe('unpaid-for-casual');
        expect(Number.isFinite(r.hours)).toBe(true);
    });
});

describe('resolveRequestedLeaveHours — degenerate input', () => {
    it('asks for dates rather than returning a number when the range is empty', () => {
        const r = resolveRequestedLeaveHours({
            leaveType: 'annual', startDate: '', endDate: '',
            contractedWeeklyHours: FT_WEEK,
        });
        expect(r.hours).toBe(0);
        expect(r.explanation).toMatch(/Choose a start and end date/);
    });

    it('never returns a negative or non-finite figure', () => {
        for (const weekly of [undefined, 0, 38, 0.5]) {
            const r = resolveRequestedLeaveHours({
                leaveType: 'annual', startDate: MON, endDate: SUN,
                contractedWeeklyHours: weekly, rosteredShifts: [],
            });
            expect(Number.isFinite(r.hours)).toBe(true);
            expect(r.hours).toBeGreaterThanOrEqual(0);
        }
    });
});
