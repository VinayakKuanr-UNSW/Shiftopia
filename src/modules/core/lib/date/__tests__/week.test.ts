import { describe, expect, it } from 'vitest';
import {
  AU_WEEK_OPTIONS,
  WEEKDAY_LABELS,
  WEEK_STARTS_ON,
  endOfWeekAU,
  getMonthGridDays,
  getMonthGridWeeks,
  getWeekDays,
  getWeekdayIndexAU,
  isWeekend,
  startOfWeekAU,
} from '../week';

/**
 * The Monday-start invariant is the whole reason this module exists, so it is
 * asserted directly rather than incidentally through a component test.
 */
describe('AU week math', () => {
  it('pins the week start to Monday', () => {
    expect(WEEK_STARTS_ON).toBe(1);
    expect(AU_WEEK_OPTIONS.weekStartsOn).toBe(1);
  });

  it('starts the week on Monday from every day of the week', () => {
    // Mon 6 Apr 2026 → Sun 12 Apr 2026.
    for (let offset = 0; offset < 7; offset++) {
      const day = new Date(2026, 3, 6 + offset);
      const start = startOfWeekAU(day);
      const end = endOfWeekAU(day);

      expect(start.getDay()).toBe(1); // Monday
      expect(end.getDay()).toBe(0);   // Sunday
      expect(start.getDate()).toBe(6);
      expect(end.getDate()).toBe(12);
    }
  });

  it('treats Sunday as the END of its week, not the start', () => {
    // The exact bug the Sunday-defaulting call sites had: on a Sunday they
    // rolled the view forward a week.
    const sunday = new Date(2026, 3, 12); // Sun 12 Apr 2026
    expect(sunday.getDay()).toBe(0);
    expect(startOfWeekAU(sunday).getDate()).toBe(6); // Mon 6 Apr, not 12 Apr
    expect(endOfWeekAU(sunday).getDate()).toBe(12);
  });

  it('returns seven days Mon→Sun', () => {
    const days = getWeekDays(new Date(2026, 3, 9)); // Thu 9 Apr 2026
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(days[0].getDate()).toBe(6);
    expect(days[6].getDate()).toBe(12);
  });

  it('crosses month and year boundaries', () => {
    // Thu 31 Dec 2026 sits in the week Mon 28 Dec 2026 – Sun 3 Jan 2027.
    const start = startOfWeekAU(new Date(2026, 11, 31));
    const end = endOfWeekAU(new Date(2026, 11, 31));
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 11, 28]);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 0, 3]);
  });
});

describe('month grid generation', () => {
  it('pads to whole Mon–Sun weeks', () => {
    const days = getMonthGridDays(new Date(2026, 3, 15)); // April 2026
    expect(days[0].getDay()).toBe(1);
    expect(days[days.length - 1].getDay()).toBe(0);
    expect(days.length % 7).toBe(0);
  });

  it('does NOT pad unconditionally to 42 cells', () => {
    // The hand-rolled grids this replaces always emitted 42 cells, so short
    // months rendered a phantom seventh week of next-month days.
    // Apr 2026: Wed 1 → Thu 30. Mon 30 Mar … Sun 3 May = 35 days.
    expect(getMonthGridDays(new Date(2026, 3, 1))).toHaveLength(35);
    // Feb 2027 starts on a Monday and has 28 days — exactly four weeks.
    expect(getMonthGridDays(new Date(2027, 1, 1))).toHaveLength(28);
  });

  it('covers every day of the target month exactly once', () => {
    const month = new Date(2026, 7, 1); // August 2026
    const days = getMonthGridDays(month);
    const inMonth = days.filter((d) => d.getMonth() === 7 && d.getFullYear() === 2026);
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth.map((d) => d.getDate())).size).toBe(31);
  });

  it('chunks into weeks of exactly seven, each Mon→Sun', () => {
    const weeks = getMonthGridWeeks(new Date(2026, 3, 1));
    expect(weeks).toHaveLength(5);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(week[0].getDay()).toBe(1);
      expect(week[6].getDay()).toBe(0);
    }
  });
});

describe('weekday helpers', () => {
  it('indexes Monday as column 0 and Sunday as column 6', () => {
    expect(getWeekdayIndexAU(new Date(2026, 3, 6))).toBe(0);  // Mon
    expect(getWeekdayIndexAU(new Date(2026, 3, 11))).toBe(5); // Sat
    expect(getWeekdayIndexAU(new Date(2026, 3, 12))).toBe(6); // Sun
  });

  it('labels columns Monday-first at every width', () => {
    expect(WEEKDAY_LABELS.short[0]).toBe('Mon');
    expect(WEEKDAY_LABELS.short[6]).toBe('Sun');
    expect(WEEKDAY_LABELS.long[0]).toBe('Monday');
    expect(WEEKDAY_LABELS.narrow).toHaveLength(7);
  });

  it('identifies the weekend', () => {
    expect(isWeekend(new Date(2026, 3, 11))).toBe(true);  // Sat
    expect(isWeekend(new Date(2026, 3, 12))).toBe(true);  // Sun
    expect(isWeekend(new Date(2026, 3, 10))).toBe(false); // Fri
  });
});
