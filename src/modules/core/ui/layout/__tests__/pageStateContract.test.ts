/**
 * Page bodies share one loading / empty / error pattern: core/ui/components/PageState.tsx.
 *
 * Before 2026-10 pages hand-rolled ~25 centred spinners (24–48px, five colours,
 * one a fuchsia CSS ring) and ~50 "No X" blocks — several dark-only
 * (`text-white/20` on a light card is invisible), one that rendered a failed
 * read as "No rate schedule found", and My Roster stacked a dashed "NO SHIFTS"
 * box under every empty day. PageState itself set its description in
 * `text-sm` — 10.5px at the 75% root. This reads the source so a page cannot
 * quietly fork the pattern again.
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

/** Out of scope: the marketing landing page. */
const EXEMPT = [
  /modules\/core\/pages\/Index\.tsx$/,
  /** A status icon that swaps to a spinner while a check runs — not a state block. */
  /modules\/compliance\/ui\/CompliancePanel\.tsx$/,
];

const BIG_SPINNER = /<Loader2\b[^>]*className=(?:"[^"]*|\{cn\([^)]*)\banimate-spin\b[^>]*/g;
const BIG = /\b[hw]-(6|7|8|9|10|12|16)\b/;

describe('page state contract', () => {
  it('PageState itself stays on the px type scale (75% root)', () => {
    const ps = sources.find((s) => s.rel.endsWith('core/ui/components/PageState.tsx'))!;
    expect(ps.code).not.toMatch(/(^|[\s'"`])text-(xs|sm|base)($|[\s'"`])/);
    expect(ps.code).toContain('motion-reduce:animate-none');
  });

  it('is used across the app (guards against an empty scan)', () => {
    expect(sources.filter((s) => s.code.includes("components/PageState'")).length).toBeGreaterThanOrEqual(30);
  });

  it('no page body hand-rolls the old empty block (icon tile + 40%-opacity text)', () => {
    const TILE = /h-1[24] w-1[24] rounded-2xl bg-muted\/40 flex items-center justify-center/;
    const offenders = sources.filter((s) => !EXEMPT.some((re) => re.test(s.rel)) && TILE.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('no page body hand-rolls a section-sized spinner (use PageState state="loading")', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      if (EXEMPT.some((re) => re.test(s.rel))) continue;
      for (const m of s.code.matchAll(BIG_SPINNER)) if (BIG.test(m[0])) offenders.push(s.rel);
    }
    expect(offenders).toEqual([]);
  });
});
