/**
 * Function bars share one row and one icon button; page footers share one bar.
 *
 * Before 2026-10 five function bars each restated the three-zone row (two
 * indented it 16px, one stacked it), their icon buttons ran 32–48px — several
 * hand-written at 40px with no focus ring — and the footers each copied the
 * Roster metrics bar with drifts, at 9–10px type. The shared pieces live in
 * core/ui/components/Toolbar.tsx and core/ui/layout/pageTokens.ts; this reads
 * the source so a new bar or footer cannot quietly fork them again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

const sources = tsxFiles(SRC).map((f) => ({
  rel: relative(SRC, f),
  code: stripComments(readFileSync(f, 'utf8')),
}));
const byName = (suffix: string) => {
  const hit = sources.find((s) => s.rel.endsWith(suffix));
  if (!hit) throw new Error(`missing ${suffix}`);
  return hit;
};

/** Function bars with a date navigator — the three-zone bars. */
const ZONE_BARS = sources.filter(
  (s) => /FunctionBar\.tsx$/.test(s.rel) && s.code.includes('<UnifiedRosterNavigator'),
);

const FOOTERS = [
  'rosters/ui/components/RosterMetricsFooter.tsx',
  'rosters/ui/components/AttendanceMetricsBar.tsx',
  'rosters/ui/components/RosterHorizontalFilterBar.tsx',
  'rosters/ui/components/RosterPaginationFooter.tsx',
];

const PAGES_WITH_FOOTERS = [
  'rosters/pages/RostersPlannerPage.tsx',
  'timesheets/ui/TimesheetPage.tsx',
  'rosters/pages/AttendancePage.tsx',
  'core/pages/MyNotificationsPage.tsx',
];

describe('function bar contract', () => {
  it('discovers the three-zone bars (guards against an empty scan)', () => {
    expect(ZONE_BARS.map((b) => b.rel.split('/').pop()).sort()).toEqual(
      expect.arrayContaining([
        'GridFunctionBar.tsx',
        'OpenBidsFunctionBar.tsx',
        'RosterFunctionBar.tsx',
        'SwapRequestsFunctionBar.tsx',
        'TimesheetFunctionBar.tsx',
      ]),
    );
  });

  it.each(ZONE_BARS.map((b) => [b.rel, b.code]))('%s lays its zones out with ToolbarRow', (_rel, code) => {
    expect(code).toContain('<ToolbarRow');
    // The old hand-written row: 16px indent and/or a stacked column.
    expect(code).not.toMatch(/min-h-16 md:h-16[^"']*px-4/);
    expect(code).not.toMatch(/flex flex-col md:flex-row items-center justify-between gap-3/);
  });

  it.each([
    'core/ui/components/UnifiedModuleFunctionBar.tsx',
    'core/ui/components/EmployeeFunctionBar.tsx',
    'leave/ui/pages/MyLeavePage.tsx',
    'leave/ui/pages/LeaveApprovalsPage.tsx',
  ])('%s also uses the shared row', (rel) => {
    expect(byName(rel).code).toContain('<ToolbarRow');
  });

  it('nothing imports the icon button from the Roster module any more', () => {
    const offenders = sources
      .filter((s) => /import \{[^}]*\bIconButton\b[^}]*\} from '[^']*RosterFunctionBar'/.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('no hand-rolled 40px icon buttons remain', () => {
    const offenders = sources
      .filter((s) => /min-h-\[40px\] min-w-\[40px\]/.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('no caller shrinks the shared icon button below its 44px box', () => {
    const offenders = sources.filter((s) =>
      [...s.code.matchAll(/<ToolbarIconButton\b([\s\S]*?)\/>/g)].some((m) =>
        /className=["'{][^>]*\b(min-)?[hw]-(8|9|10|\[(3\d|40)px\])\b/.test(m[1]),
      ),
    );
    expect(offenders.map((s) => s.rel)).toEqual([]);
  });
});

describe('every page toolbar resolves to the shared row', () => {
  const headerPages = sources.filter(
    (s) => s.code.includes('<GoldStandardHeader') && !s.rel.endsWith('components/GoldStandardHeader.tsx'),
  );
  const barFile = (name: string) => sources.find((s) => new RegExp(`export (const|function) ${name}\\b`).test(s.code));

  it.each(headerPages.map((p) => [p.rel, p.code]))('%s', (_rel, code) => {
    const hasBar = /functionBar=\{/.test(code);
    const builtIn = /\bviewMode=\{/.test(code.slice(code.indexOf('<GoldStandardHeader'), code.indexOf('<GoldStandardHeader') + 1500));
    if (code.includes('<ToolbarRow')) return; // the page builds its row inline
    if (!hasBar && !builtIn) return; // title + scope only (no function bar row at all)
    // Otherwise the row comes from a bar component (or the header's built-in bar).
    const m = code.match(/functionBar=\{\s*(?:!?[\w.]+\s*\?\s*\(?\s*)?<([A-Z]\w+)/);
    const name = m?.[1] ?? 'UnifiedModuleFunctionBar';
    const bar = barFile(name);
    expect(bar, `no component file for ${name}`).toBeTruthy();
    expect(bar!.code).toContain('<ToolbarRow');
  });

  it('nothing is parked beside the clock (no rightActions slot)', () => {
    expect(sources.filter((s) => /\brightActions=/.test(s.code)).map((s) => s.rel)).toEqual([]);
  });

  it('no function bar or page claims role="toolbar" (it would promise arrow-key movement)', () => {
    // The sidebar is out of scope: its quick-actions row is its own design.
    const scoped = sources.filter(
      (s) => /FunctionBar\.tsx$/.test(s.rel) || s.code.includes('<GoldStandardHeader') || s.code.includes('<ToolbarRow'),
    );
    expect(scoped.filter((s) => /role="toolbar"/.test(s.code)).map((s) => s.rel)).toEqual([]);
  });
});

describe('page body contract', () => {
  const headerPages = sources.filter(
    (s) => s.code.includes('<GoldStandardHeader') && !s.rel.endsWith('components/GoldStandardHeader.tsx'),
  );

  it.each(headerPages.map((p) => [p.rel, p.code]))('%s draws no body card of its own', (_rel, code) => {
    // The old hand-written card: an isDark branch with the glass colours, or a drifted radius.
    expect(code).not.toMatch(/bg-\[#1c2333\]\/40 border-white\/5 shadow-2xl shadow-black\/20/);
    expect(code).not.toMatch(/rounded-\[(24|28)px\]/);
  });
});

describe('page footer contract', () => {
  it.each(FOOTERS)('%s sits in the shared footer bar', (rel) => {
    expect(byName(rel).code).toContain('surface.footerBar');
  });

  it.each(FOOTERS)('%s keeps the bar itself at or above the 11px type floor', (rel) => {
    // Keyboard-hint strips inside the footer's dropdown menus are menu content,
    // not the footer row — tracked separately.
    const rowLines = byName(rel).code.split('\n').filter((l) => !l.includes('bg-indigo-50/50'));
    expect(rowLines.join('\n')).not.toMatch(/text-\[(7|8|9|10)px\]/);
  });

  it.each(PAGES_WITH_FOOTERS)('%s renders its footer in PageLayout.Footer', (rel) => {
    const code = byName(rel).code;
    expect(code).toContain('<PageLayout.Footer');
    // The old body+footer wrapper with its own 10px gap.
    expect(code).not.toMatch(/flex-1 min-h-0 overflow-hidden flex flex-col gap-2\.5/);
    expect(code).not.toMatch(/space-y-2\.5 md:space-y-4/);
  });
});
