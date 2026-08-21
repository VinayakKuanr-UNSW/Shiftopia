import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two facts about the shift cards that live in the JSX, not in exported logic,
 * and that have both regressed once already by being quietly reverted.
 *
 * These read the source. That is a blunt instrument, so it is used only where
 * the alternative is mounting a ~1400-line component with a dozen providers to
 * assert one prop. **Comments are stripped before matching** — a previous
 * source-reading test in this repo passed against the comment describing the
 * bug it was meant to catch, see the `source-reading-tests-match-comments`
 * lesson.
 */

function sourceWithoutComments(relativePath: string): string {
  const raw = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments, incl. JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // line comments, sparing "https://"
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ''); // JSX comment expressions
}

const CARDS = {
  SmartShiftCard: 'src/modules/rosters/ui/components/SmartShiftCard.tsx',
  ShiftDetailsDialog: 'src/modules/rosters/ui/my-roster/ShiftDetailsDialog.tsx',
  TimesheetMobileCard: 'src/modules/timesheets/ui/components/TimesheetMobileCard.tsx',
  MyOffersModal: 'src/modules/rosters/ui/my-roster/MyOffersModal.tsx',
} as const;

describe('shift card contracts', () => {
  it('every timecard surface opts into the shared identity grid', () => {
    // The drill-down panel rendered the old role heading for a while because
    // this one prop had been dropped from SmartShiftCard.
    for (const [name, path] of Object.entries(CARDS)) {
      const src = sourceWithoutComments(path);
      expect(src, `${name} renders a timecard`).toMatch(/variant="timecard"/);
      expect(src, `${name} must pass identityGrid`).toMatch(/\bidentityGrid\b/);
    }
  });

  it('prices off the shift, never off the profile scalar first', () => {
    // `profiles.employment_type` is a person-level summary and cannot describe
    // someone holding several contracts at once. Reading it ahead of the
    // shift's own basis drops the 25% casual loading — a ~20% understatement.
    const smart = sourceWithoutComments(CARDS.SmartShiftCard);

    const target = smart.indexOf('shift.target_employment_type');
    const profile = smart.indexOf('assigned_profiles?.employment_type');

    expect(target, 'SmartShiftCard reads the shift target').toBeGreaterThan(-1);
    expect(profile, 'SmartShiftCard keeps the profile as a fallback').toBeGreaterThan(-1);
    expect(
      target,
      'the shift target must be consulted BEFORE the profile scalar',
    ).toBeLessThan(profile);
  });

  it('formats clock times through the one Sydney-pinned helper', () => {
    // Three surfaces each had their own formatter for the same field and two
    // were wrong: the roster card sliced the ISO string and never converted
    // (a 00:25 clock-in that was really 10:25 AM), and the timesheet card read
    // `new Date(t).getHours()`, i.e. the viewer's own timezone.
    for (const [name, path] of Object.entries(CARDS)) {
      const src = sourceWithoutComments(path);
      if (!/\bclockIn=/.test(src)) continue;
      expect(src, `${name} must use formatClockTime`).toMatch(/\bformatClockTime\b/);
      expect(src, `${name} must not slice the time out of an ISO string`)
        .not.toMatch(/split\(['"]T['"]\)\[1\]/);
      expect(src, `${name} must not read clock times in the browser timezone`)
        .not.toMatch(/\.getHours\(\)/);
    }
  });

  it('feeds the min-engagement top-up to every surface that prices a shift', () => {
    // The badge is the only sign a shift is PAID more hours than it was
    // worked. The roster card computed the floor and threw the flag away.
    for (const name of ['SmartShiftCard', 'ShiftDetailsDialog', 'TimesheetMobileCard'] as const) {
      const src = sourceWithoutComments(CARDS[name]);
      expect(src, `${name} passes wasToppedUpToMinEngagement`)
        .toMatch(/wasToppedUpToMinEngagement=/);
      expect(src, `${name} passes requiredEngagementMinutes`)
        .toMatch(/requiredEngagementMinutes=/);
    }
  });

  it('does not resolve pay from the viewer in the shift details dialog', () => {
    const dialog = sourceWithoutComments(CARDS.ShiftDetailsDialog);

    // Whatever it hands the estimator must start from the shift's own basis.
    expect(dialog).toMatch(/target_employment_type\s*\?\?\s*user\?\.employmentType/);
    // …and never the bare viewer value on its own.
    expect(dialog).not.toMatch(/employmentType:\s*user\?\.employmentType\s*,/);
  });
});
