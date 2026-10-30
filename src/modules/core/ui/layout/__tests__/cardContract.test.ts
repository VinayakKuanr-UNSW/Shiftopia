/**
 * Cards share one anatomy: core/ui/primitives/card.tsx (`cardTokens`).
 *
 * Before 2026-10 the domain cards ran 12/16/24/28px radii, p-3 to p-6,
 * shadow-none to shadow-2xl plus coloured glows, scaled or lifted on hover,
 * and set 9–10px type (`text-xs` is 9px at the 75% root). Two broadcast cards
 * blurred their backdrop — decoration that also traps position:fixed children —
 * and the base Card was dark-only (`border-white/10`). This reads the source so
 * a card cannot quietly fork the anatomy again.
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
 * Cards that live inside fixed-size roster/template grid cells — their type and
 * density belong to the grid pass, not this one.
 */
const GRID_CARDS = [
  'rosters/ui/components/SmartShiftCard.tsx',
  'rosters/ui/components/ShiftCardLegend.tsx',
  'templates/ui/components/ShiftCard.tsx',
  'templates/ui/components/editor/TemplateGroupCard.tsx',
  'templates/ui/components/editor/TemplateSubgroupCard.tsx',
];

const DOMAIN_CARDS = sources.filter(
  (s) =>
    /Card[s]?\.tsx$/.test(s.rel) &&
    !s.rel.includes('core/ui/primitives/') &&
    !GRID_CARDS.some((g) => s.rel.endsWith(g)),
);

const FORBIDDEN: Array<[RegExp, string]> = [
  [/text-\[(9|10)px\]/, 'type below the 11px floor'],
  [/(^|[\s'"`])text-xs($|[\s'"`])/, 'text-xs is 9px at the 75% root'],
  [/font-black/, 'weight above the 600 hierarchy'],
  [/rounded-3xl|rounded-\[(2[4-9]|3\d)px\]|rounded-\[1\.2rem\]/, 'radius outside the 16px card shell'],
  [/backdrop-blur-(sm|md|lg|xl|2xl|3xl)/, 'decorative blur (traps position:fixed)'],
  [/active:scale-\[0\.98\]|hover:translate-y|hover:scale-/, 'card moves on hover/press (use cardTokens.interactive)'],
  [/hover:shadow-(xl|2xl)/, 'elevation outside the one-step scale'],
];

describe('card contract', () => {
  it('discovers the domain cards (guards against an empty scan)', () => {
    expect(DOMAIN_CARDS.length).toBeGreaterThanOrEqual(12);
  });

  it('the base Card is theme-neutral and never blurs', () => {
    const card = sources.find((s) => s.rel.endsWith('core/ui/primitives/card.tsx'))!;
    expect(card.code).not.toMatch(/border-white\/|backdrop-blur|shadow-glow/);
    expect(card.code).toContain('cardTokens');
  });

  it('no domain card restates a forbidden size, weight, radius, blur or motion', () => {
    const offenders: string[] = [];
    for (const s of DOMAIN_CARDS) {
      for (const [re, why] of FORBIDDEN) if (re.test(s.code)) offenders.push(`${s.rel}: ${why}`);
    }
    expect(offenders).toEqual([]);
  });
});
