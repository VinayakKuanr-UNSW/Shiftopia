/**
 * List tables share one anatomy: core/ui/primitives/table.tsx.
 *
 * Before 2026-10 every list table hand-rolled its <table>: header type ran
 * 9px (`text-xs` at the 75% root) to 14px in four weights, padding was p-3,
 * px-4 py-4, px-5 py-3.5 or px-3 py-2, and four pages sorted from a click-only
 * <th> a keyboard could not reach. This reads the source so a new table cannot
 * quietly fork the anatomy again.
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

/**
 * Raw <table> is allowed only where the primitive cannot express the shape —
 * and even then the file must build its cells from `tableTokens`. Matrices,
 * legends and calendars are not list tables and are listed separately.
 */
const NOT_LIST_TABLES = [
  'core/ui/primitives/table.tsx',
  'core/ui/primitives/calendar.tsx',
  'core/ui/calendar/MonthGrid.tsx',
  'rosters/ui/modes/GroupModeView.tsx',
  'rosters/ui/modes/PeopleModeGrid.tsx',
  'rosters/ui/modes/RolesModeView.tsx',
  'rosters/ui/components/ShiftCardLegend.tsx',
  'rosters/ui/components/BadgeLegendPopover.tsx',
  'availability/ui/team/TeamAvailabilityGrid.tsx',
  'availability/ui/team/CoverageHeatmap.tsx',
  'insights/ui/components/KpiTrendChart.tsx',
  /** A calculation sheet nested inside a Gross Pay row, not a list. */
  'payroll/ui/EarningsLinesTable.tsx',
];

const RAW_TABLE = /<table[\s>]/;
const TABLE_CELL = /<(TableHead|TableCell)\b((?:=>|"[^"]*"|[^>"])*?)>/g;
const TH = /<th\b((?:=>|"[^"]*"|[^>"])*?)>/g;

describe('list table contract', () => {
  it('scans real tables (guards against an empty scan)', () => {
    const users = sources.filter((s) => s.code.includes("primitives/table'"));
    expect(users.length).toBeGreaterThanOrEqual(15);
  });

  it('every raw <table> outside the matrix list builds its cells from tableTokens', () => {
    const offenders = sources
      .filter((s) => RAW_TABLE.test(s.code))
      .filter((s) => !NOT_LIST_TABLES.some((n) => s.rel.endsWith(n)))
      .filter((s) => !s.code.includes('tableTokens'))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('TableHead / TableCell never restate the token-owned padding or type size', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      for (const m of s.code.matchAll(TABLE_CELL)) {
        const cls = /className="([^"]*)"/.exec(m[2])?.[1] ?? '';
        if (/(^|\s)(p|px|py)-\d|(^|\s)text-(xs|sm|\[(9|10)px\])(\s|$)|font-black/.test(cls)) {
          offenders.push(`${s.rel}: <${m[1]} className="${cls}">`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no header sorts from a click-only <th> (use SortableTableHeader or a button)', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      for (const m of s.code.matchAll(TH)) {
        if (m[1].includes('onClick') && !m[1].includes('onKeyDown')) offenders.push(s.rel);
      }
      for (const m of s.code.matchAll(TABLE_CELL)) {
        if (m[1] === 'TableHead' && m[2].includes('onClick')) offenders.push(s.rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
