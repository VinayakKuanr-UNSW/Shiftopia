/**
 * Type is written in px on one scale: 11 · 13 · 14 · 15 · 17 · 20 · 24 · 28 · 36.
 *
 * The root font is 75% (src/index.css) and stays that way (user decision,
 * 2026-10-24). So Tailwind's named sizes lie: `text-xs` is 9px, `text-sm`
 * 10.5px, `text-base` 12px. Before the sweep ~2,700 named or sub-floor sizes
 * were in use — 870 of them 7–10px literals. Every size now says what it
 * renders. This reads the source so a named size or a sub-11px literal cannot
 * creep back in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : codeFiles(full);
    return /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

/**
 * Protected Global Scope (and the dropdowns that must keep matching it),
 * plus the marketing landing page (outside this pass).
 */
const EXEMPT =
  /(GlobalScopeFilter|CommandSelector|PersonalPageHeader|PersonalScopeFilter|GroupBySelector|SortSelector|PageMenu|ColumnsPicker)\.tsx$|core\/pages\/Index\.tsx$|primitives\/sidebar\.tsx$/;

const sources = codeFiles(SRC)
  .map((f) => ({ rel: relative(SRC, f), code: stripComments(readFileSync(f, 'utf8')) }))
  .filter((s) => !EXEMPT.test(s.rel));

const NAMED = /(?<![\w[\-/])(?:[\w-]+:)*text-(xs|sm|base|lg|xl|[2-6]xl)(?![\w\-\]])/;
const SUB_FLOOR = /text-\[(?:[1-9]|10)(?:\.\d+)?px\]/;

describe('type scale contract', () => {
  it('scans the app (guards against an empty scan)', () => {
    expect(sources.length).toBeGreaterThan(500);
  });

  it('no named Tailwind text size (they render 25% small at the 75% root)', () => {
    const offenders = sources.filter((s) => NAMED.test(s.code)).map((s) => `${s.rel}: ${s.code.match(NAMED)![0]}`);
    expect(offenders).toEqual([]);
  });

  it('no text below the 11px floor', () => {
    const offenders = sources.filter((s) => SUB_FLOOR.test(s.code)).map((s) => `${s.rel}: ${s.code.match(SUB_FLOOR)![0]}`);
    expect(offenders).toEqual([]);
  });

  it('form controls are 16px on phones (iOS zooms anything smaller on focus)', () => {
    for (const name of ['input', 'textarea', 'select']) {
      const p = sources.find((s) => s.rel.endsWith(`core/ui/primitives/${name}.tsx`))!;
      expect(p.code, name).toMatch(/text-\[16px\] md:text-\[13px\]/);
    }
  });
});
