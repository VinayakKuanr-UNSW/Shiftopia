import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A PENDING offer is encoded as `lifecycle_status = 'Published'` +
 * `assignment_outcome IS NULL`, and nothing rewrites those when an offer lapses.
 * So the predicate is unbounded: it accumulates every offer the employee was
 * ever sent and never actioned, for the life of the account.
 *
 * That is not a modal-only cost. `MyRosterPage` calls `useMyOffers` on mount to
 * build its calendar offer-dots, so the unbounded query ran on every My Roster
 * page load.
 *
 * Source-read rather than mounted, following the convention in
 * `offer-response-refetch.test.ts`: the alternative is standing up a Supabase
 * query-builder mock deep enough to observe one `.gte()`. Comments are stripped
 * first — a test that matches the comment describing the bug is worthless.
 */

const SRC = resolve(process.cwd(), 'src/modules/rosters/api/shifts.queries.ts');

function bodyOf(fn: string): string {
  const raw = readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const start = raw.indexOf(`async ${fn}(`);
  if (start === -1) throw new Error(`${fn} not found`);
  const next = raw.indexOf('\n    async ', start + 1);
  return raw.slice(start, next === -1 ? undefined : next);
}

describe('pending-offer queries are bounded', () => {
  for (const fn of ['getMyOffers', 'getPendingOfferCount']) {
    it(`${fn} floors on shift_date`, () => {
      const body = bodyOf(fn);
      expect(body, `${fn} still selects unbounded history`).toMatch(
        /\.gte\(\s*['"]shift_date['"]\s*,\s*actionableOfferFloor\(\)\s*\)/,
      );
    });
  }

  it('both use the SAME floor, so the badge cannot disagree with the list', () => {
    // The count and the list are rendered side by side — a badge reading "3"
    // over a list of 1 is worse than either bound on its own.
    const list = bodyOf('getMyOffers');
    const count = bodyOf('getPendingOfferCount');
    const floorOf = (b: string) => b.match(/\.gte\(\s*['"]shift_date['"]\s*,\s*([^)]+)\)/)?.[1]?.trim();
    expect(floorOf(list)).toBeDefined();
    expect(floorOf(list)).toBe(floorOf(count));
  });

  it('the floor is derived in Sydney, not from the browser timezone', () => {
    const raw = readFileSync(SRC, 'utf8');
    const helper = raw.slice(raw.indexOf('function actionableOfferFloor'));
    expect(helper).toMatch(/getTodayInTimezone\(\s*SYDNEY_TZ\s*\)/);
    // Never `toISOString()`: that shifts to UTC and rolls the day for a viewer
    // west of Sydney, hiding an offer for today.
    expect(helper.slice(0, helper.indexOf('}'))).not.toMatch(/toISOString/);
  });
});
