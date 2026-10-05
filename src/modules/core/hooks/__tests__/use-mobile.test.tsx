import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as React from 'react';

/**
 * `useIsMobile` is called by 25 component types, one of which is the roster
 * shift chip — so it runs once per CARD, not once per screen. The previous
 * implementation gave each of those its own `matchMedia` listener.
 *
 * The listener count is the whole point of the rewrite, so it is what these
 * tests assert. The store is module-level state, so every test re-imports the
 * module after `resetModules()` to get a clean one.
 */

/** A controllable `matchMedia` that records how many listeners are attached. */
function installMatchMedia(initialMatches: boolean) {
  const handlers = new Set<(e: { matches: boolean }) => void>();
  const state = { matches: initialMatches, constructed: 0 };

  window.matchMedia = ((query: string) => {
    state.constructed += 1;
    return {
      get matches() { return state.matches; },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { handlers.add(cb); },
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { handlers.delete(cb); },
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;

  return {
    state,
    get listenerCount() { return handlers.size; },
    resize(matches: boolean) {
      state.matches = matches;
      act(() => { for (const h of [...handlers]) h({ matches }); });
    },
  };
}

const originalMatchMedia = window.matchMedia;

async function freshHook() {
  vi.resetModules();
  const mod = await import('../use-mobile');
  return mod.useIsMobile;
}

beforeEach(() => vi.resetModules());
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('useIsMobile', () => {
  it('reports the viewport on the FIRST render, with no effect flush', async () => {
    // Regression guard: a lazy-effect version rendered the desktop layout for one
    // frame and then swapped, which was the dominant CLS source on the rosters
    // page. The value must be right during render, not after.
    installMatchMedia(true);
    const useIsMobile = await freshHook();
    const seen: boolean[] = [];
    const Probe = () => { seen.push(useIsMobile()); return null; };

    render(<Probe />);
    expect(seen[0]).toBe(true);
  });

  it('attaches ONE listener no matter how many components subscribe', async () => {
    const mm = installMatchMedia(false);
    const useIsMobile = await freshHook();
    const Card = () => { useIsMobile(); return null; };

    render(
      <>{Array.from({ length: 40 }, (_, i) => <Card key={i} />)}</>,
    );

    // The old implementation registered one per instance — this would be 40.
    expect(mm.listenerCount).toBe(1);
  });

  it('releases the listener once the last subscriber unmounts', async () => {
    const mm = installMatchMedia(false);
    const useIsMobile = await freshHook();
    const Card = () => { useIsMobile(); return null; };

    const { unmount } = render(<><Card /><Card /><Card /></>);
    expect(mm.listenerCount).toBe(1);

    unmount();
    expect(mm.listenerCount).toBe(0);
  });

  it('fans a single change out to every subscriber', async () => {
    const mm = installMatchMedia(false);
    const useIsMobile = await freshHook();
    const seen: boolean[][] = [[], [], []];
    const Card = ({ i }: { i: number }) => { seen[i].push(useIsMobile()); return null; };

    render(<><Card i={0} /><Card i={1} /><Card i={2} /></>);
    expect(seen.map((s) => s.at(-1))).toEqual([false, false, false]);

    mm.resize(true);
    expect(seen.map((s) => s.at(-1))).toEqual([true, true, true]);
  });

  it('does not re-render subscribers when the breakpoint did not actually cross', async () => {
    // A resize that keeps the same side of the breakpoint fires `change` in some
    // browsers; the store drops it so 40 cards do not all re-render for nothing.
    const mm = installMatchMedia(false);
    const useIsMobile = await freshHook();
    let renders = 0;
    const Card = () => { renders += 1; useIsMobile(); return null; };

    render(<Card />);
    const before = renders;

    mm.resize(false); // same value
    expect(renders).toBe(before);

    mm.resize(true);  // genuine crossing
    expect(renders).toBeGreaterThan(before);
  });
});
