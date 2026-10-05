import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Accepting an offer has to actually put the shift on My Roster.
 *
 * `useMyRoster` hides a pending offer client-side (`Published` + `assigned` +
 * `assignment_outcome` NULL), so responding to one moves the shift ACROSS a
 * visibility boundary rather than changing a field in place. Marking the list
 * stale is not enough: "stale" only becomes "fresh" when something triggers a
 * refetch, and in the Capacitor WebView nothing does — there is no window-focus
 * event, and My Roster stays mounted behind the sheet so it never remounts
 * either. The accepted shift simply never arrived on a phone.
 *
 * Source-read because the alternative is standing up a QueryClient, a mocked
 * Supabase command and a mounted provider tree to observe one option. Comments
 * are stripped first — see the `source-reading-tests-match-comments` lesson.
 */

const SRC = resolve(process.cwd(), 'src/modules/rosters/state/useRosterShifts.ts');

function bodyOf(hook: string): string {
  const raw = readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const start = raw.indexOf(`export function ${hook}()`);
  if (start === -1) throw new Error(`${hook} not found`);
  const next = raw.indexOf('\nexport function ', start + 1);
  return raw.slice(start, next === -1 ? undefined : next);
}

describe('offer responses refetch the roster', () => {
  for (const hook of ['useAcceptOffer', 'useDeclineOffer']) {
    it(`${hook} refetches the shift lists rather than only marking them stale`, () => {
      const body = bodyOf(hook);

      expect(body, `${hook} invalidates the lists`).toMatch(/queryKey:\s*shiftKeys\.lists/);
      expect(
        body,
        `${hook} must NOT pass refetchType: 'none' — the shift crosses a visibility boundary`,
      ).not.toMatch(/shiftKeys\.lists,\s*refetchType:\s*['"]none['"]/);
    });
  }

  it('leaves the planner mutations on the cheaper stale-only path', () => {
    // The convention is right for the rest of the file: the optimistic patch
    // has already applied the change, and the planner has a dozen cached weeks
    // it should not re-download to confirm one field.
    const raw = readFileSync(SRC, 'utf8');
    expect(raw.match(/refetchType:\s*['"]none['"]/g)?.length ?? 0).toBeGreaterThan(5);
  });
});
