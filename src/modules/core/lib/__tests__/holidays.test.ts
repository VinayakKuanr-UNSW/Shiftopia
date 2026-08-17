import { describe, expect, it } from 'vitest';
import {
  getPublicHolidayName,
  getPublicHolidayNameISO,
  getShiftDayType,
  isPublicHoliday,
  isPublicHolidayISO,
} from '../holidays';

/**
 * Regression cover for the consolidation of three rival holiday sources into
 * one. Each block below is a case at least one of the retired implementations
 * got wrong.
 */
describe('NSW public holidays', () => {
  it('resolves fixed-date national holidays', () => {
    expect(isPublicHoliday(new Date(2026, 0, 1))).toBe(true);   // New Year's Day
    expect(isPublicHoliday(new Date(2026, 0, 26))).toBe(true);  // Australia Day
    expect(isPublicHoliday(new Date(2026, 11, 25))).toBe(true); // Christmas Day
    expect(isPublicHoliday(new Date(2026, 11, 26))).toBe(true); // Boxing Day
  });

  it('resolves MOVING holidays beyond the hard-coded 2026 window', () => {
    // `date.utils.ts` returned false for all of these outside 2026, and
    // `anz-holidays.ts` ran out of entries after 2027.
    expect(getPublicHolidayName(new Date(2027, 2, 26))).toMatch(/Good Friday/i);
    expect(getPublicHolidayName(new Date(2027, 5, 14))).toMatch(/King's Birthday/i);
    expect(getPublicHolidayName(new Date(2027, 9, 4))).toMatch(/Labour Day/i);
    expect(getPublicHolidayName(new Date(2028, 3, 14))).toMatch(/Good Friday/i);
    expect(isPublicHoliday(new Date(2029, 0, 26))).toBe(true);
  });

  it('includes the NSW substitute days that attract penalty rates', () => {
    // Anzac Day 2026 falls on a Saturday; NSW observes Mon 27 Apr.
    expect(isPublicHoliday(new Date(2026, 3, 27))).toBe(true);
    expect(getPublicHolidayName(new Date(2026, 3, 27))).toMatch(/substitute/i);
    // Boxing Day 2026 falls on a Saturday; NSW observes Mon 28 Dec.
    expect(isPublicHoliday(new Date(2026, 11, 28))).toBe(true);
  });

  it('does NOT treat New Zealand holidays as public holidays', () => {
    // The roster planner grid used to mark these, via `anz-holidays.ts`.
    expect(isPublicHoliday(new Date(2026, 1, 6))).toBe(false);  // Waitangi Day
    expect(isPublicHoliday(new Date(2026, 6, 10))).toBe(false); // Matariki
    expect(isPublicHoliday(new Date(2026, 9, 26))).toBe(false); // NZ Labour Day
  });

  it('returns null / false for ordinary days', () => {
    expect(isPublicHoliday(new Date(2026, 3, 14))).toBe(false);
    expect(getPublicHolidayName(new Date(2026, 3, 14))).toBeNull();
  });

  it('handles invalid input without throwing', () => {
    expect(isPublicHoliday(new Date(NaN))).toBe(false);
    expect(getPublicHolidayName(new Date(NaN))).toBeNull();
    expect(isPublicHolidayISO(null)).toBe(false);
    expect(isPublicHolidayISO('')).toBe(false);
    expect(getPublicHolidayNameISO(undefined)).toBeNull();
  });
});

describe('ISO-string lookups', () => {
  it('agrees with the Date-based lookups', () => {
    expect(isPublicHolidayISO('2026-04-03')).toBe(true);
    expect(isPublicHolidayISO('2026-04-14')).toBe(false);
    expect(getPublicHolidayNameISO('2026-12-25')).toMatch(/Christmas/i);
  });

  it('parses on local date parts, not UTC', () => {
    // A UTC parse of '2026-01-01' is 11:00 on 1 Jan in Sydney but 20:00 on
    // 31 Dec in Los Angeles — the day would roll and the holiday be missed.
    expect(isPublicHolidayISO('2026-01-01')).toBe(true);
    expect(getShiftDayType('2026-01-01').isPublicHoliday).toBe(true);
  });
});

describe('getShiftDayType', () => {
  it('flags Sundays and public holidays independently', () => {
    expect(getShiftDayType('2026-04-05')).toEqual({ isSunday: true, isPublicHoliday: true }); // Easter Sunday
    expect(getShiftDayType('2026-04-12')).toEqual({ isSunday: true, isPublicHoliday: false });
    expect(getShiftDayType('2026-04-03')).toEqual({ isSunday: false, isPublicHoliday: true }); // Good Friday
    expect(getShiftDayType('2026-04-14')).toEqual({ isSunday: false, isPublicHoliday: false });
  });

  it('is inert for missing or malformed dates', () => {
    expect(getShiftDayType(null)).toEqual({ isSunday: false, isPublicHoliday: false });
    expect(getShiftDayType('not-a-date')).toEqual({ isSunday: false, isPublicHoliday: false });
  });
});
