import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as React from 'react';

/** Counts ShiftPill renders: it calls `cn` in its JSX on every render. */
const cnSpy = vi.fn();
vi.mock('@/modules/core/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/core/lib/utils')>();
  return { ...actual, cn: (...args: unknown[]) => { cnSpy(); return actual.cn(...(args as [])); } };
});

const ShiftPill = (await import('../ShiftPill')).default;

/**
 * Hostile-input and render-volume cover for the My Roster card tree.
 *
 * Shift text (`roles.name`, `sub_group_name`, group labels) originates in the
 * database and is written by managers, so it is not trusted input in the strict
 * sense — but it is input this component does not control, and the roster is the
 * one screen every employee opens.
 */

const shift = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  shift_date: '2026-09-18',
  start_time: '09:00:00',
  end_time: '17:00:00',
  lifecycle_status: 'Published',
  roles: { name: 'Steward' },
  ...over,
}) as never;

const XSS_PAYLOADS: Array<[string, string]> = [
  ['script tag',      '<script>window.__pwned=1</script>'],
  ['img onerror',     '<img src=x onerror="window.__pwned=1">'],
  ['svg onload',      '<svg onload="window.__pwned=1">'],
  ['javascript url',  'javascript:window.__pwned=1'],
  ['entity encoded',  '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['template-ish',    '${constructor.constructor("window.__pwned=1")()}'],
];

beforeEach(() => { delete (window as unknown as Record<string, unknown>).__pwned; });

describe('shift text is rendered as TEXT, never as markup', () => {
  it.each(XSS_PAYLOADS)('neutralises a %s in the role name', (_label, payload) => {
    const { container } = render(
      <ShiftPill shift={shift({ roles: { name: payload } })} groupName="Theatre" groupColor="theatre" subGroupName="Stage" />,
    );

    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[onload]')).toBeNull();
    // …and it is still shown to the user, escaped, rather than silently dropped.
    expect(container.textContent).toContain(payload);
  });

  it.each(XSS_PAYLOADS)('neutralises a %s in the sub-group name', (_label, payload) => {
    const { container } = render(
      <ShiftPill
        shift={shift()}
        groupName="Theatre"
        groupColor="theatre"
        subGroupName={payload}
        style={{ height: 120 }}
      />,
    );
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not let a payload reach an href or src attribute', () => {
    const { container } = render(
      <ShiftPill shift={shift({ roles: { name: 'javascript:alert(1)' } })} groupName="x" groupColor="x" subGroupName="y" />,
    );
    for (const el of Array.from(container.querySelectorAll('*'))) {
      expect(el.getAttribute('href')).toBeNull();
      expect(el.getAttribute('src')).toBeNull();
    }
  });
});

describe('no raw-HTML sink exists in the My Roster tree', () => {
  // The tests above rely on React escaping. This is what keeps that true: a
  // future `dangerouslySetInnerHTML` would make them pass while the page is
  // nonetheless injectable.
  it('no component uses dangerouslySetInnerHTML', () => {
    const dir = resolve(process.cwd(), 'src/modules/rosters/ui/my-roster');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('dangerouslySetInnerHTML'));
    expect(offenders).toEqual([]);
  });
});

describe('one malformed row must not take down the calendar', () => {
  // `ShiftPill` read `shift.start_time.slice(0, 5)` directly and threw on a null.
  //
  // Not reachable from a normal fetch — `start_time`, `end_time` and `shift_date`
  // are all NOT NULL in the database, verified against production. The exposure
  // is the paths that do NOT go through a fetch: optimistic cache writes and
  // realtime payloads, which carry partial rows by construction.
  //
  // Worth guarding anyway because of blast radius: the nearest error boundary is
  // at the ROUTE (`AppRouter`'s AuthLayout), so a throw in one chip unmounts the
  // whole page instead of degrading one card to `--:--`.
  it.each([
    ['null start_time',   { start_time: null }],
    ['missing start_time', { start_time: undefined }],
    ['null end_time',     { end_time: null }],
    ['empty times',       { start_time: '', end_time: '' }],
  ])('renders with %s instead of throwing', (_label, patch) => {
    expect(() =>
      render(<ShiftPill shift={shift(patch)} groupName="Theatre" groupColor="theatre" subGroupName="Stage" />),
    ).not.toThrow();
  });

  it('survives a role object that is missing entirely', () => {
    expect(() =>
      render(<ShiftPill shift={shift({ roles: null })} groupName="Theatre" groupColor="theatre" subGroupName="Stage" />),
    ).not.toThrow();
  });

  it('survives absurd text without throwing', () => {
    const nasty = [
      'A'.repeat(50_000),
      '\u202E' + 'gnp.exe',           // RTL override
      '\u0000\u0001\u0002',            // control chars
      '👨‍👩‍👧‍👦'.repeat(500),           // ZWJ sequences
    ];
    for (const n of nasty) {
      expect(() =>
        render(<ShiftPill shift={shift({ roles: { name: n } })} groupName={n} groupColor="x" subGroupName={n} style={{ height: 120 }} />),
      ).not.toThrow();
    }
  });
});

describe('render volume', () => {
  it('renders a full desktop month of chips (126) without error', () => {
    const chips = Array.from({ length: 126 }, (_, i) => (
      <ShiftPill
        key={i}
        shift={shift({ id: `s${i}`, roles: { name: `Role ${i}` } })}
        groupName="Theatre"
        groupColor="theatre"
        subGroupName="Stage"
      />
    ));
    const { container } = render(<>{chips}</>);
    expect(container.querySelectorAll('button')).toHaveLength(126);
  });

  it('is memoised, so a parent re-render does not re-render 126 chips', () => {
    // Counts ShiftPill's OWN renders via the `cn` call it makes in its JSX on
    // every render. A memo bail-out skips the render entirely, so the count does
    // not move; an unstable prop reintroduced upstream makes it jump by ~126.
    //
    // An earlier version of this test counted a separate probe component, which
    // would have passed whether or not ShiftPill was memoised at all.
    cnSpy.mockClear();

    // Hoisted, exactly as production does it: `useMyRoster`'s index builds each
    // ShiftWithDetails once per fetch, so `data.shift` keeps its identity across
    // parent re-renders. Building these inside the render would bust memo on the
    // `shift` prop and measure nothing about the component.
    const rows = Array.from({ length: 126 }, (_, i) => shift({ id: `s${i}` }));
    const onSelect = () => {};
    const Parent = ({ tick }: { tick: number }) => (
      <div data-tick={tick}>
        {rows.map((row, i) => (
          <ShiftPill
            key={i}
            shift={row}
            groupName="Theatre"
            groupColor="theatre"
            subGroupName="Stage"
            onClick={onSelect}
          />
        ))}
      </div>
    );

    const { rerender } = render(<Parent tick={0} />);
    const afterMount = cnSpy.mock.calls.length;
    expect(afterMount, 'the chips really did render').toBeGreaterThan(126);

    rerender(<Parent tick={1} />);
    expect(cnSpy.mock.calls.length, '126 chips re-rendered on a parent update').toBe(afterMount);
  });

  it('DOES re-render the chips when an unstable prop is passed', () => {
    // The negative control: proves the counter above can detect a regression.
    cnSpy.mockClear();
    const rows = Array.from({ length: 10 }, (_, i) => shift({ id: `s${i}` }));
    const Parent = ({ tick }: { tick: number }) => (
      <div>
        {rows.map((row, i) => (
          <ShiftPill
            key={i}
            shift={row}
            groupName="Theatre"
            groupColor="theatre"
            subGroupName="Stage"
            onClick={() => tick}
          />
        ))}
      </div>
    );

    const { rerender } = render(<Parent tick={0} />);
    const afterMount = cnSpy.mock.calls.length;
    rerender(<Parent tick={1} />);
    expect(cnSpy.mock.calls.length).toBeGreaterThan(afterMount);
  });
});
