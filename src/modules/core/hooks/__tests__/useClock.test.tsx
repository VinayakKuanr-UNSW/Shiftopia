import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as React from 'react';
import {
  useClockValue,
  isShiftPast,
  __resetClockForTests,
  __advanceClockForTests,
  type ClockSnapshot,
} from '../useClock';

const at = (todayStr: string, hhmm: string): ClockSnapshot => {
  const [h, m] = hhmm.split(':').map(Number);
  return { todayStr, minutesSinceMidnight: h * 60 + m, epochMs: 0 };
};

beforeEach(() => __resetClockForTests(at('2026-09-17', '12:00')));

describe('isShiftPast', () => {
  const now = at('2026-09-17', '12:00');

  it('is false for a future day and true for a past one', () => {
    expect(isShiftPast('2026-09-18', '10:00', now)).toBe(false);
    expect(isShiftPast('2026-09-16', '23:00', now)).toBe(true);
  });

  it('compares end time within today', () => {
    expect(isShiftPast('2026-09-17', '11:59', now)).toBe(true);
    expect(isShiftPast('2026-09-17', '12:00', now)).toBe(false); // not yet PAST it
    expect(isShiftPast('2026-09-17', '17:00', now)).toBe(false);
  });

  it('treats 00:00 as the END of the day, not the start', () => {
    // The trap: a shift finishing at midnight reads as minute 0, so a naive
    // comparison marks it past from 00:01 onwards.
    expect(isShiftPast('2026-09-17', '00:00', now)).toBe(false);
    expect(isShiftPast('2026-09-17', '00:00', at('2026-09-17', '23:59'))).toBe(false);
  });

  it('rolls an OVERNIGHT shift end to the next day', () => {
    // 22:00-06:00 starting today is NOT past at noon, nor at 23:00 — it has not
    // begun/finished yet. Both previous implementations resolved 06:00 against
    // the START date, so the shift counted as finished for its entire duration.
    expect(isShiftPast('2026-09-17', '06:00', now, '22:00')).toBe(false);
    expect(isShiftPast('2026-09-17', '06:00', at('2026-09-17', '23:00'), '22:00')).toBe(false);
    // Next morning, after 06:00, it finally is.
    expect(isShiftPast('2026-09-17', '06:00', at('2026-09-18', '06:01'), '22:00')).toBe(true);
    expect(isShiftPast('2026-09-17', '06:00', at('2026-09-18', '05:59'), '22:00')).toBe(false);
  });

  it('keeps a 00:00 end on the STARTING day even with a start time', () => {
    // `doesShiftTrulyCrossMidnight` treats an exact-midnight finish as the end of
    // the starting day, not a crossing. This must agree with it.
    expect(isShiftPast('2026-09-17', '00:00', at('2026-09-17', '23:59'), '16:00')).toBe(false);
    expect(isShiftPast('2026-09-17', '00:00', at('2026-09-18', '00:01'), '16:00')).toBe(true);
  });

  it('is inert for missing or malformed input', () => {
    expect(isShiftPast(null, '10:00', now)).toBe(false);
    expect(isShiftPast('2026-09-17', null, now)).toBe(false);
    expect(isShiftPast('2026-09-17', 'not-a-time', now)).toBe(false);
  });
});

describe('useClockValue', () => {
  it('re-renders a subscriber when ITS value flips', () => {
    const renders: boolean[] = [];
    const Card = () => {
      const select = React.useCallback((n: ClockSnapshot) => isShiftPast('2026-09-17', '13:00', n), []);
      const v = useClockValue(select);
      renders.push(v);
      return null;
    };
    render(<Card />);
    expect(renders.at(-1)).toBe(false);

    act(() => __advanceClockForTests(at('2026-09-17', '13:01')));
    expect(renders.at(-1)).toBe(true);
  });

  it('does NOT re-render a subscriber whose value is unchanged', () => {
    // The property that makes a per-card clock affordable: a tick must not
    // re-render every card on screen, only the ones that actually changed.
    let renderCount = 0;
    const Card = () => {
      const select = React.useCallback((n: ClockSnapshot) => isShiftPast('2026-12-25', '17:00', n), []);
      useClockValue(select);
      renderCount += 1;
      return null;
    };
    render(<Card />);
    const before = renderCount;

    act(() => __advanceClockForTests(at('2026-09-17', '12:01')));
    act(() => __advanceClockForTests(at('2026-09-17', '12:02')));

    expect(renderCount).toBe(before);
  });

  it('re-renders only the cards that crossed, out of a mixed set', () => {
    const counts = [0, 0, 0];
    // ends 12:30 (will flip), ends 18:00 (will not), ended yesterday (already true)
    const specs: Array<[string, string]> = [
      ['2026-09-17', '12:30'],
      ['2026-09-17', '18:00'],
      ['2026-09-16', '18:00'],
    ];
    const Card = ({ i }: { i: number }) => {
      const select = React.useCallback((n: ClockSnapshot) => isShiftPast(specs[i][0], specs[i][1], n), [i]);
      useClockValue(select);
      counts[i] += 1;
      return null;
    };
    render(<><Card i={0} /><Card i={1} /><Card i={2} /></>);
    const before = [...counts];

    act(() => __advanceClockForTests(at('2026-09-17', '12:31')));

    expect(counts[0]).toBeGreaterThan(before[0]); // flipped false -> true
    expect(counts[1]).toBe(before[1]);            // still false
    expect(counts[2]).toBe(before[2]);            // still true
  });

  it('runs at most one timer regardless of subscriber count, and clears it on unmount', () => {
    vi.useFakeTimers();
    try {
      __resetClockForTests(at('2026-09-17', '12:00'));
      const Card = () => {
        const select = React.useCallback((n: ClockSnapshot) => n.todayStr, []);
        useClockValue(select);
        return null;
      };
      const { unmount } = render(<>{Array.from({ length: 30 }, (_, i) => <Card key={i} />)}</>);

      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
