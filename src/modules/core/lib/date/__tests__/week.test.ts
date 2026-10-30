import { describe, expect, it } from 'vitest';
import {
  AU_WEEK_OPTIONS,
  WEEK_STARTS_ON,
  endOfWeekAU,
  getWeekDays,
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
