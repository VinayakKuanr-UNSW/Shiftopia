import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * Complexity guards for `useMyRoster`.
 *
 * `getShiftsForDate` used to be a fresh closure running `shifts.filter(...)` plus
 * two `date-fns#format` calls per invocation, and the desktop month view calls it
 * three times per cell — 126 full scans of the roster per render. It is now a
 * `Map.get` over an index built once per fetch.
 *
 * Wall-clock assertions are flaky on shared CI, so the primary test here is
 * DETERMINISTIC: the shifts array is a `Proxy` that counts element reads. After
 * the index is built, a correct implementation touches it ZERO more times. A
 * regression to per-call filtering shows up as a non-zero count regardless of how
 * fast the machine is.
 */

const mockShifts = vi.fn<() => any[]>(() => []);

vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'emp-1' } }) }));
vi.mock('@/modules/core/contexts/OrgSelectionContext', () => ({
  useOrgSelection: () => ({ organizationId: null, departmentId: null, subDepartmentId: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockShifts(), isLoading: false, error: null }),
}));
vi.mock('@/modules/rosters/api/shifts.queries', () => ({ shiftsQueries: { getEmployeeShifts: vi.fn() } }));
vi.mock('@/modules/rosters/api/queryKeys', () => ({ shiftKeys: { byEmployee: () => ['k'] } }));

const { useMyRoster } = await import('../useMyRoster');

/** A month of shifts, `perDay` on each day, deterministic. */
function buildRoster(days: number, perDay: number) {
  const out: any[] = [];
  const base = new Date(2026, 3, 1);
  for (let d = 0; d < days; d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    const key = `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, '0')}-${`${day.getDate()}`.padStart(2, '0')}`;
    for (let i = 0; i < perDay; i++) {
      out.push({
        id: `s-${d}-${i}`,
        shift_date: key,
        start_time: '09:00',
        end_time: '17:00',
        is_overnight: false,
        lifecycle_status: 'Published',
        assignment_status: 'assigned',
        assignment_outcome: 'Accepted',
        group_type: 'theatre',
        sub_group_name: 'Stage',
        organization_id: 'org-1',
        department_id: 'dept-1',
        sub_department_id: 'sub-1',
      });
    }
  }
  return out;
}

/** Wraps an array so numeric element reads are counted. */
function countingArray<T>(rows: T[]) {
  const counter = { reads: 0 };
  const proxy = new Proxy(rows, {
    get(target, prop, recv) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) counter.reads += 1;
      return Reflect.get(target, prop, recv);
    },
  });
  return { proxy, counter };
}

/** The 42 cells of a month grid. */
const monthCells = () =>
  Array.from({ length: 42 }, (_, i) => new Date(2026, 2, 30 + i));

beforeEach(() => mockShifts.mockReturnValue([]));

describe('lookup cost is independent of roster size', () => {
  it('touches the shifts array ZERO times after the index is built', () => {
    const { proxy, counter } = countingArray(buildRoster(31, 3));
    mockShifts.mockReturnValue(proxy);

    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    const afterBuild = counter.reads;
    expect(afterBuild).toBeGreaterThan(0); // the index really did read the rows

    // What the desktop month view does per render: 42 cells x 3 asks.
    for (const cell of monthCells()) {
      result.current.getShiftsForDate(cell, { includeContinuations: false });
      result.current.getShiftsForDate(cell, { includeContinuations: false });
      result.current.getShiftsForDate(cell);
    }

    expect(
      counter.reads - afterBuild,
      'getShiftsForDate re-scanned the roster instead of using the index',
    ).toBe(0);
  });

  it('builds the index in a single pass over the rows', () => {
    // One read per row. Two passes would be correct but wasteful, and would mean
    // the scope filter or the continuation split had been split out again.
    const rows = buildRoster(31, 4); // 124 rows
    const { proxy, counter } = countingArray(rows);
    mockShifts.mockReturnValue(proxy);

    renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    expect(counter.reads).toBeLessThanOrEqual(rows.length * 1.5);
  });
});

describe('stress', () => {
  it('indexes a 10,000-shift roster and still answers every cell correctly', () => {
    const rows = buildRoster(200, 50); // 10,000
    mockShifts.mockReturnValue(rows);

    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    // Spot-check a day in the middle: 50 shifts, all of them.
    const day = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false });
    expect(day).toHaveLength(50);
    expect(new Set(day.map((s) => s.shift.id)).size).toBe(50);

    // And a day beyond the generated range is empty, not undefined.
    expect(result.current.getShiftsForDate(new Date(2030, 0, 1))).toEqual([]);
  });

  it('answers a full month grid over a 10,000-shift roster well inside a frame budget', () => {
    // Deliberately generous (the deterministic proxy test above is the real
    // guard); this only catches an accidental return to O(rows) per call, which
    // would be ~1.26M comparisons plus 252 `format()` calls here.
    const rows = buildRoster(200, 50);
    mockShifts.mockReturnValue(rows);
    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    const cells = monthCells();
    const t0 = performance.now();
    for (let pass = 0; pass < 10; pass++) {
      for (const cell of cells) {
        result.current.getShiftsForDate(cell, { includeContinuations: false });
        result.current.getShiftsForDate(cell, { includeContinuations: false });
        result.current.getShiftsForDate(cell);
      }
    }
    const elapsed = performance.now() - t0;

    // 10 renders' worth of lookups (1,260 calls) in under 50ms.
    expect(elapsed).toBeLessThan(50);
  });

  it('does not allocate a new array per lookup, however large the roster', () => {
    // Every allocation here is a prop identity change downstream, which is what
    // defeats `React.memo` on the chips.
    mockShifts.mockReturnValue(buildRoster(200, 50));
    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    const a = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false });
    const b = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false });
    expect(a).toBe(b);

    // Empty days share one frozen array rather than minting 42 of them.
    const e1 = result.current.getShiftsForDate(new Date(2030, 0, 1));
    const e2 = result.current.getShiftsForDate(new Date(2031, 5, 9));
    expect(e1).toBe(e2);
  });

  it('keeps entry identities stable across lookups, so chips can memo', () => {
    mockShifts.mockReturnValue(buildRoster(31, 3));
    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    const first = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false })[0];
    const again = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false })[0];
    expect(first).toBe(again);
  });

  it('handles a roster that is ENTIRELY overnight continuations', () => {
    // Worst case for the index: every row lands in two buckets.
    const rows = buildRoster(60, 20).map((r) => ({ ...r, start_time: '22:00', end_time: '06:00' }));
    mockShifts.mockReturnValue(rows);
    const { result } = renderHook(() => useMyRoster('month' as any, new Date(2026, 3, 15), undefined));

    const own = result.current.getShiftsForDate(new Date(2026, 3, 15), { includeContinuations: false });
    const withCont = result.current.getShiftsForDate(new Date(2026, 3, 15));
    expect(own).toHaveLength(20);
    expect(withCont).toHaveLength(40); // 20 starting + 20 spilling in from the 14th
  });
});
