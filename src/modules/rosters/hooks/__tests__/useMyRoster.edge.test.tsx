import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * Adversarial and boundary cover for `useMyRoster`'s date index.
 *
 * The happy path lives in `useMyRoster.test.tsx`. This file is the other half:
 * rows the UI should never receive but might (optimistic cache writes, offer
 * mappings, a widened enum, a bad migration), and the calendar boundaries where
 * date arithmetic goes wrong.
 *
 * The index feeds a calendar that renders whatever it returns, so "garbage in"
 * must mean "that row is inert", never "the page throws" and never "a value of
 * the wrong TYPE reaches React".
 */

const mockShifts = vi.fn<() => any[]>(() => []);
const mockOrg = vi.fn<() => any>(() => ({ organizationId: null, departmentId: null, subDepartmentId: null }));

vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'emp-1' } }) }));
vi.mock('@/modules/core/contexts/OrgSelectionContext', () => ({ useOrgSelection: () => mockOrg() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockShifts(), isLoading: false, error: null }),
}));
vi.mock('@/modules/rosters/api/shifts.queries', () => ({ shiftsQueries: { getEmployeeShifts: vi.fn() } }));
vi.mock('@/modules/rosters/api/queryKeys', () => ({ shiftKeys: { byEmployee: () => ['k'] } }));

const { useMyRoster } = await import('../useMyRoster');

function shift(over: Record<string, any> & { id: string; shift_date: string }) {
  return {
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
    ...over,
  };
}

const D = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const render = (view = 'month', on = '2026-04-15', scope?: any) =>
  renderHook(() => useMyRoster(view as any, D(on), scope)).result;

beforeEach(() => {
  mockShifts.mockReturnValue([]);
  mockOrg.mockReturnValue({ organizationId: null, departmentId: null, subDepartmentId: null });
});

describe('hostile group_type values', () => {
  // The index looks group labels up by `shift.group_type`. That lookup used to be
  // a ternary chain and became a Record during the refactor — at which point
  // `GROUP_NAMES['constructor']` stopped returning undefined and started
  // returning a FUNCTION off Object.prototype, so `?? 'General'` never fired.
  // React throws "Functions are not valid as a React child" on that.
  const POLLUTERS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

  it.each(POLLUTERS)('falls back to the General label for group_type=%s', (bad) => {
    mockShifts.mockReturnValue([shift({ id: 'x', shift_date: '2026-04-15', group_type: bad })]);
    const [entry] = render().current.getShiftsForDate(D('2026-04-15'));

    expect(typeof entry.groupName).toBe('string');
    expect(typeof entry.groupColor).toBe('string');
    expect(entry.groupName).toBe('General');
    expect(entry.groupColor).toBe('default');
  });

  it('never yields a non-string label for any group_type, including null', () => {
    for (const g of [null, undefined, '', 0, false, {}, [], 'theatre', 'constructor']) {
      mockShifts.mockReturnValue([shift({ id: 'x', shift_date: '2026-04-15', group_type: g })]);
      const [entry] = render().current.getShiftsForDate(D('2026-04-15'));
      expect(typeof entry.groupName, `group_type=${JSON.stringify(g)}`).toBe('string');
      expect(typeof entry.groupColor, `group_type=${JSON.stringify(g)}`).toBe('string');
    }
  });
});

describe('malformed rows are inert, not fatal', () => {
  it('survives a row with no times at all', () => {
    mockShifts.mockReturnValue([
      { id: 'broken', shift_date: '2026-04-15', lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: 'Accepted' },
    ]);
    expect(() => render().current.getShiftsForDate(D('2026-04-15'))).not.toThrow();
  });

  it.each([
    ['impossible hours', '99:99'],
    ['non-numeric', 'ab:cd'],
    ['empty', ''],
    ['negative', '-1:00'],
  ])('survives a %s end_time', (_label, endTime) => {
    mockShifts.mockReturnValue([shift({ id: 'x', shift_date: '2026-04-15', end_time: endTime })]);
    expect(() => render().current.getShiftsForDate(D('2026-04-15'))).not.toThrow();
  });

  it.each(['', '0000-00-00', 'not-a-date', '2026-13-45'])(
    'does not crash on shift_date=%s, and does not leak it into a real day',
    (bad) => {
      mockShifts.mockReturnValue([
        shift({ id: 'bad', shift_date: bad }),
        shift({ id: 'good', shift_date: '2026-04-15' }),
      ]);
      const r = render();
      expect(() => r.current.getShiftsForDate(D('2026-04-15'))).not.toThrow();
      // The good row must still be found; the malformed one must not displace it.
      expect(r.current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['good']);
    },
  );

  it('tolerates a null shift_date without bucketing it anywhere real', () => {
    mockShifts.mockReturnValue([shift({ id: 'nul', shift_date: null as any })]);
    const r = render();
    expect(() => r.current.getShiftsForDate(D('2026-04-15'))).not.toThrow();
    expect(r.current.getShiftsForDate(D('2026-04-15'))).toEqual([]);
  });

  it('keeps BOTH rows when two shifts share an id', () => {
    // Dedupe is the query layer's job; silently dropping one here would hide a
    // real shift from someone's roster.
    mockShifts.mockReturnValue([
      shift({ id: 'dup', shift_date: '2026-04-15', start_time: '09:00' }),
      shift({ id: 'dup', shift_date: '2026-04-15', start_time: '14:00' }),
    ]);
    expect(render().current.getShiftsForDate(D('2026-04-15'))).toHaveLength(2);
  });
});

describe('calendar boundaries', () => {
  it('rolls a continuation across a YEAR boundary', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'nye', shift_date: '2026-12-31', start_time: '22:00', end_time: '06:00' }),
    ]);
    expect(render('month', '2026-12-15').current.getShiftsForDate(D('2027-01-01')).map((s) => s.shift.id))
      .toEqual(['nye']);
  });

  it('rolls a continuation across a LEAP day', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'leap', shift_date: '2028-02-28', start_time: '22:00', end_time: '06:00' }),
    ]);
    const r = render('month', '2028-02-15');
    expect(r.current.getShiftsForDate(D('2028-02-29')).map((s) => s.shift.id)).toEqual(['leap']);
    expect(r.current.getShiftsForDate(D('2028-03-01'))).toEqual([]);
  });

  it('rolls a continuation across the AEDT->AEST switch', () => {
    // 5 Apr 2026 is the Sydney DST end. A Date-arithmetic day roll can land on
    // the same calendar day when the clock goes back an hour.
    mockShifts.mockReturnValue([
      shift({ id: 'dst', shift_date: '2026-04-04', start_time: '22:00', end_time: '06:00' }),
    ]);
    expect(render('month', '2026-04-01').current.getShiftsForDate(D('2026-04-05')).map((s) => s.shift.id))
      .toEqual(['dst']);
  });

  it('is unaffected by the browser timezone (no UTC day-roll)', () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
      // A `toISOString()`-based key would put this on the 14th for a viewer west
      // of Sydney and the shift would vanish from the roster.
      expect(render().current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['a']);
    } finally {
      process.env.TZ = tz;
    }
  });
});

describe('scope filtering is total, not partial', () => {
  it('an empty scope array means "no constraint", not "match nothing"', () => {
    // Regression risk: treating `[]` as a filter would empty every roster the
    // moment the scope tree had not loaded yet.
    mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
    const scope = { org_ids: [], dept_ids: [], subdept_ids: [] };
    expect(render('month', '2026-04-15', scope).current.getShiftsForDate(D('2026-04-15'))).toHaveLength(1);
  });

  it('a scope that matches nothing yields an empty day, not every day', () => {
    mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
    const scope = { org_ids: ['org-other'], dept_ids: [], subdept_ids: [] };
    expect(render('month', '2026-04-15', scope).current.getShiftsForDate(D('2026-04-15'))).toEqual([]);
  });

  it('excludes a scoped-out shift from its CONTINUATION day too', () => {
    // The scope check runs once at index time, so it must cover both buckets an
    // overnight shift lands in — otherwise a filtered shift reappears tomorrow.
    mockShifts.mockReturnValue([
      shift({ id: 'night', shift_date: '2026-04-15', start_time: '22:00', end_time: '06:00', organization_id: 'org-2' }),
    ]);
    const scope = { org_ids: ['org-1'], dept_ids: [], subdept_ids: [] };
    const r = render('month', '2026-04-15', scope);
    expect(r.current.getShiftsForDate(D('2026-04-15'))).toEqual([]);
    expect(r.current.getShiftsForDate(D('2026-04-16'))).toEqual([]);
  });

  it('hides an S3 offer on its continuation day as well', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'offer', shift_date: '2026-04-15', start_time: '22:00', end_time: '06:00', assignment_outcome: null }),
    ]);
    const r = render();
    expect(r.current.getShiftsForDate(D('2026-04-15'))).toEqual([]);
    expect(r.current.getShiftsForDate(D('2026-04-16'))).toEqual([]);
  });
});
