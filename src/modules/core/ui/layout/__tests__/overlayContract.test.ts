/**
 * Overlays share one anatomy: core/ui/primitives/overlay-tokens.ts.
 *
 * Before 2026-10 the five overlay primitives each had their own scrim
 * (black/40–80, blur or not), radius (0–20px) and type — every title 13.5px and
 * every description 10.5px (`text-sm` at the 75% root) — the Drawer border was
 * dark-only, and callers set twelve different widths and radii up to 40px.
 * Four modals were hand-built `fixed inset-0` divs with no dialog role, no
 * focus trap and no Escape. This reads the source so an overlay cannot quietly
 * fork the anatomy again.
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
const callers = sources.filter((s) => !s.rel.includes('core/ui/primitives/'));

const OVERLAY_TAG = /<(DialogContent|AlertDialogContent|ResponsiveDialog)\b((?:=>|"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\}|[^>"{])*)>/g;

describe('overlay contract', () => {
  it('every overlay primitive builds on overlayTokens', () => {
    for (const name of ['dialog', 'alert-dialog', 'sheet', 'drawer', 'popover']) {
      const p = sources.find((s) => s.rel.endsWith(`core/ui/primitives/${name}.tsx`))!;
      expect(p.code, name).toContain('overlayTokens');
      expect(p.code, name).not.toMatch(/(^|[\s'"`])text-(sm|lg)($|[\s'"`])|border-white\//);
    }
  });

  it('scans real overlays (guards against an empty scan)', () => {
    const n = callers.reduce((acc, s) => acc + [...s.code.matchAll(OVERLAY_TAG)].length, 0);
    expect(n).toBeGreaterThanOrEqual(100);
  });

  it('callers size dialogs with `size`, never a max-w class, and never restate the radius', () => {
    const offenders: string[] = [];
    for (const s of callers) {
      for (const m of s.code.matchAll(OVERLAY_TAG)) {
        const cls = [...m[2].matchAll(/(?:className|dialogClassName)="([^"]*)"/g)].map((x) => x[1]).join(' ');
        if (/(^|\s)(sm:)?max-w-|(^|\s)(sm:)?rounded-/.test(cls)) offenders.push(`${s.rel}: ${m[1]} "${cls}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nobody hides the close button with [&>button]:hidden (use hideClose)', () => {
    const offenders = callers
      .filter((s) => !s.rel.endsWith('core/ui/primitives/sidebar.tsx') && s.code.includes('[&>button]:hidden'))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('a hand-built fixed overlay is a real modal: dialog role, aria-modal and Escape', () => {
    const offenders = callers
      .filter((s) => /fixed inset-0[^"'`]*bg-black\//.test(s.code))
      .filter((s) => !(s.code.includes('role="dialog"') && s.code.includes('aria-modal') && s.code.includes('Escape')))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});
