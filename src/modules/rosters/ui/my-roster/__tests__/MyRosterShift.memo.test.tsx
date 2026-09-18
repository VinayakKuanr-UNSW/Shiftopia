import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

/**
 * `React.memo` is only worth anything if the props are referentially stable, and
 * the old contract guaranteed they were not: every call site passed an inline
 * `onClick={() => ...}` arrow, and the grid views an inline `style={{ height }}`
 * object. Two fresh identities per card, per render.
 *
 * That mattered because the desktop month grid renders up to 126 of these
 * (42 cells x 3 chips) and re-renders whenever `selectedShift` changes — i.e.
 * every time you open or close a shift dialog.
 *
 * These tests pin the contract that makes memo hold. They count renders of the
 * INNER card, so they fail if someone reintroduces an unstable prop.
 */

const renderSpy = vi.fn();

// Stub the leaves: this is about the memo boundary, not about pill markup.
vi.mock('../ShiftPill', () => ({
  default: (props: Record<string, unknown>) => { renderSpy(props); return <div data-testid="pill" />; },
}));
vi.mock('@/modules/planning/ui/components/SharedShiftCard', () => ({
  SharedShiftCard: (props: Record<string, unknown>) => { renderSpy(props); return <div data-testid="card" />; },
}));
vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'Test User' } }) }));

const MyRosterShift = (await import('../MyRosterShift')).default;
import type { ShiftWithDetails } from '@/modules/rosters';

const data = {
  shift: {
    id: 's1',
    shift_date: '2026-09-17',
    start_time: '09:00:00',
    end_time: '17:00:00',
    lifecycle_status: 'Published',
    roles: { name: 'Steward' },
    organizations: { name: 'ICC' },
    paid_break_minutes: 0,
    unpaid_break_minutes: 30,
  },
  groupName: 'Theatre',
  groupColor: 'theatre',
  subGroupName: 'Stage',
} as unknown as ShiftWithDetails;

beforeEach(() => renderSpy.mockClear());

describe('MyRosterShift memoisation', () => {
  it('does NOT re-render when the parent re-renders with identical props', () => {
    const onSelect = vi.fn();
    const Parent = ({ tick }: { tick: number }) => (
      <div data-tick={tick}>
        <MyRosterShift data={data} dateKey="2026-09-17" compact onSelect={onSelect} />
      </div>
    );

    const { rerender } = render(<Parent tick={0} />);
    const afterFirst = renderSpy.mock.calls.length;

    rerender(<Parent tick={1} />);
    rerender(<Parent tick={2} />);

    expect(renderSpy.mock.calls.length).toBe(afterFirst);
  });

  it('DOES re-render when the shift data actually changes', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <MyRosterShift data={data} dateKey="2026-09-17" compact onSelect={onSelect} />,
    );
    const afterFirst = renderSpy.mock.calls.length;

    const moved = { ...data, shift: { ...data.shift, start_time: '10:00:00' } } as ShiftWithDetails;
    rerender(<MyRosterShift data={moved} dateKey="2026-09-17" compact onSelect={onSelect} />);

    expect(renderSpy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('takes `height` as a number, so a grid view does not hand it a fresh object each render', () => {
    // The old prop was `style={{ height }}` — a new object identity every render,
    // which defeats memo on its own no matter how stable the callback is.
    const onSelect = vi.fn();
    const Parent = ({ tick }: { tick: number }) => (
      <div data-tick={tick}>
        <MyRosterShift data={data} dateKey="2026-09-17" height={64} onSelect={onSelect} />
      </div>
    );

    const { rerender } = render(<Parent tick={0} />);
    const afterFirst = renderSpy.mock.calls.length;

    rerender(<Parent tick={1} />);
    expect(renderSpy.mock.calls.length).toBe(afterFirst);

    // …and it still reaches the pill as a style, so layout is unchanged.
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ style: { height: 64 } }));
  });

  it('passes the clicked dateKey back, not the shift date', () => {
    // Load bearing for the 3-day view, which asks for continuations: an overnight
    // shift also renders under the FOLLOWING day and the dialog must open there.
    const onSelect = vi.fn();
    render(<MyRosterShift data={data} dateKey="2026-09-18" compact onSelect={onSelect} />);

    const pillProps = renderSpy.mock.calls.at(-1)![0] as { onClick: () => void };
    pillProps.onClick();

    expect(onSelect).toHaveBeenCalledWith(data, '2026-09-18');
  });
});
