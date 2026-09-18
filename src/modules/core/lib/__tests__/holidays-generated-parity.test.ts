import { describe, expect, it } from 'vitest';
import Holidays from 'date-holidays';
import {
  getPublicHolidayNameISO,
  isPublicHolidayISO,
  PUBLIC_HOLIDAY_YEAR_RANGE,
} from '../holidays';
import { HOLIDAY_NAMES, PACKED_BY_YEAR } from '../holidays.generated';

/**
 * `holidays.generated.ts` is baked from `date-holidays` at build time so the
 * library (and its moment-timezone / astronomia tail — 1,380 KB, 57% of the
 * eager entry chunk) stays out of the browser bundle. `date-holidays` remains a
 * devDependency purely so this test can prove the bake is faithful.
 *
 * If this fails after a `date-holidays` bump, or after NSW legislates a new
 * holiday, run `npm run gen:holidays` and commit the regenerated file.
 */

const hd = new Holidays('AU', 'NSW');
const { min, max } = PUBLIC_HOLIDAY_YEAR_RANGE;

/** Every AU/NSW `type === 'public'` date the library knows, as YYYY-MM-DD → name. */
function libraryPublicHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of hd.getHolidays(year)) {
    if (entry.type !== 'public') continue;
    const key = entry.date.slice(0, 10);
    if (Number(key.slice(0, 4)) !== year) continue; // rolled out of the window
    out.set(key, entry.name);
  }
  return out;
}

describe('generated NSW holiday table is faithful to date-holidays', () => {
  it('matches the library for every year in the coverage window', () => {
    const mismatches: string[] = [];

    for (let year = min; year <= max; year++) {
      const expected = libraryPublicHolidays(year);

      for (const [key, name] of expected) {
        if (!isPublicHolidayISO(key)) mismatches.push(`${key} missing (${name})`);
        else if (getPublicHolidayNameISO(key) !== name) {
          mismatches.push(`${key} name "${getPublicHolidayNameISO(key)}" != "${name}"`);
        }
      }

      // And nothing extra: walk the packed row back out.
      for (const entry of (PACKED_BY_YEAR[String(year)] ?? '').split(',').filter(Boolean)) {
        const [mmdd] = entry.split(':');
        const key = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`;
        if (!expected.has(key)) mismatches.push(`${key} is in the table but not a public holiday`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('excludes observance and bank days, which do NOT attract penalty rates', () => {
    // This is the whole reason the raw `hd.isHoliday()` calls were removed from
    // the cost engine: it is truthy for these, so Mother's Day, Father's Day and
    // the NSW August Bank Holiday were each priced at public-holiday rates.
    const nonPublic: Array<[string, string]> = [];
    for (let year = min; year <= max; year++) {
      for (const entry of hd.getHolidays(year)) {
        if (entry.type === 'public') continue;
        nonPublic.push([entry.date.slice(0, 10), `${entry.name} (${entry.type})`]);
      }
    }

    expect(nonPublic.length).toBeGreaterThan(0); // guard: the fixture still has them

    for (const [date, label] of nonPublic) {
      expect(isPublicHolidayISO(date), `${date} ${label} must not be a public holiday`).toBe(false);
    }

    // Named spot-checks, so the intent survives a library data change.
    expect(hd.isHoliday('2026-05-10')).toBeTruthy();       // Mother's Day — library says "holiday"
    expect(isPublicHolidayISO('2026-05-10')).toBe(false);  // …we say: not a public holiday
    expect(hd.isHoliday('2026-08-03')).toBeTruthy();       // NSW August Bank Holiday
    expect(isPublicHolidayISO('2026-08-03')).toBe(false);
    expect(hd.isHoliday('2026-09-06')).toBeTruthy();       // Father's Day
    expect(isPublicHolidayISO('2026-09-06')).toBe(false);
  });

  it('interns every name index the packed rows reference', () => {
    for (const packed of Object.values(PACKED_BY_YEAR)) {
      for (const entry of packed.split(',').filter(Boolean)) {
        const idx = Number(entry.split(':')[1]);
        expect(HOLIDAY_NAMES[idx]).toBeTypeOf('string');
      }
    }
  });
});

describe('coverage window', () => {
  it('extends at least 10 years past today', () => {
    // The generated table is finite where the library was unbounded. This is
    // the guard that turns "silently wrong in 2076" into a failing build with
    // a decade of warning: regenerate with a wider MAX_YEAR.
    const currentYear = new Date().getFullYear();
    expect(max).toBeGreaterThanOrEqual(currentYear + 10);
    expect(min).toBeLessThanOrEqual(currentYear - 5);
  });

  it('answers false, not undefined, outside the window', () => {
    expect(isPublicHolidayISO(`${max + 1}-01-01`)).toBe(false);
    expect(getPublicHolidayNameISO(`${max + 1}-01-01`)).toBeNull();
  });
});
