/**
 * Every page is GoldStandardHeader inside the PageLayout shell, and only the
 * shell decides the gutter.
 *
 * Before 2026-10 pages wrapped PersonalPageHeader in their own copy of the
 * glass card, and each one pasted its own gutter onto its body — so the same
 * header sat at a different height, with a different gap to the body, on
 * every page. Two (Users, Profile) leaned on <main>'s padding and broke when it
 * was removed; one (My Attendance) stripped the header's padding with
 * `className="p-0"`, which tailwind-merge only applied below lg. Nothing in the
 * type system stops a page doing any of that again, so this reads the source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Comments mention these names freely; only code counts. */
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

const isHeaderItself = (rel: string) => rel.endsWith('components/GoldStandardHeader.tsx');

/** Every component that renders a page header — discovered, not listed. */
const PAGES = sources.filter((s) => s.code.includes('<GoldStandardHeader') && !isHeaderItself(s.rel));

describe('page header contract', () => {
  it('discovers the pages (guards against the scan silently finding nothing)', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(25);
  });

  it('only GoldStandardHeader renders PersonalPageHeader', () => {
    const offenders = sources
      .filter((s) => /\bPersonalPageHeader\b/.test(s.code))
      .map((s) => s.rel)
      .filter((rel) => !rel.endsWith('components/PersonalPageHeader.tsx') && !isHeaderItself(rel));
    expect(offenders).toEqual([]);
  });

  it.each(PAGES.map((p) => [p.rel, p.code]))('%s renders GoldStandardHeader inside PageLayout', (_rel, code) => {
    const shell = code.indexOf('<PageLayout');
    expect(shell).toBeGreaterThan(-1);
    expect(code.indexOf('<GoldStandardHeader')).toBeGreaterThan(shell);
  });

  it.each(PAGES.map((p) => [p.rel, p.code]))('%s leaves the gutter to the shell', (_rel, code) => {
    // The outer gutter pasted onto a body, as margins or as padding.
    expect(code).not.toMatch(/\blg:mx-6\b/);
    expect(code).not.toMatch(/\bmb-4 lg:mb-6\b/);
    expect(code).not.toMatch(/\bpx-4 lg:px-6 pb-/);
    // Gutter-sized negative margins that bleed into a parent's padding (Profile).
    expect(code).not.toMatch(/(^|[\s"'`])(md:)?-mx-(4|6|8)\b/);
    // A second sticky header wrapper around a hand-written card.
    expect(code).not.toMatch(/sticky top-0 z-30/);
  });

  it.each(PAGES.map((p) => [p.rel, p.code]))('%s does not restyle the header from outside', (_rel, code) => {
    // Any className on the header (My Attendance's "p-0") fights the shell.
    // Props nested inside `{…}` (a Button in rightActions) are not the header's.
    for (const at of [...code.matchAll(/<GoldStandardHeader\b/g)].map((m) => m.index!)) {
      expect(topLevelProps(code, at)).not.toContain('className');
    }
  });
});

/** Attribute names of the JSX tag opening at `start`, ignoring anything inside braces. */
function topLevelProps(code: string, start: number): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = code.indexOf(' ', start); i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) {
      if (c === '>') break;
      const m = /^\s([A-Za-z]+)=/.exec(code.slice(i, i + 64));
      if (m) names.push(m[1]);
    }
  }
  return names;
}
