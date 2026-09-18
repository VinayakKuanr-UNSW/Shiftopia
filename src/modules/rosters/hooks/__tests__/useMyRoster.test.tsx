import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * `getShiftsForDate` used to be a fresh closure per render that ran
 * `shifts.filter(...)` plus two `date-fns#format` calls on every invocation —
 * and the desktop month view invokes it three times per cell. It is now backed
 * by a date index built once per fetch/scope change.
 *
 * These tests pin the BEHAVIOUR that refactor had to preserve, because the
 * subtle parts (continuation ordering, the S3 hide, the relaxed no-scope
 * fallback) are easy to lose and invisible until a shift goes missing from
 * someone's roster.
 */

const mockShifts = vi.fn<() => any[]>(() => []);
const mockOrg = vi.fn<() => any>(() => ({ organizationId: null, departmentId: null, subDepartmentId: null }));

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'emp-1' } }),
}));
vi.mock('@/modules/core/contexts/OrgSelectionContext', () => ({
  useOrgSelection: () => mockOrg(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockShifts(), isLoading: false, error: null }),
}));
vi.mock('@/modules/rosters/api/shifts.queries', () => ({ shiftsQueries: { getEmployeeShifts: vi.fn() } }));
vi.mock('@/modules/rosters/api/queryKeys', () => ({ shiftKeys: { byEmployee: () => ['k'] } }));

const { useMyRoster } = await import('../useMyRoster');

/** Minimal shift row. Defaults are "assigned, visible, does not cross midnight". */
function shift(over: Partial<Record<string, any>> & { id: string; shift_date: string }) {
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

const render = (scope?: any) =>
  renderHook(() => useMyRoster('month' as any, D('2026-04-15'), scope)).result;

beforeEach(() => {
  mockShifts.mockReturnValue([]);
  mockOrg.mockReturnValue({ organizationId: null, departmentId: null, subDepartmentId: null });
});

describe('useMyRoster — day bucketing', () => {
  it('returns shifts that start on the requested day', () => {
    mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
    const r = render();
    expect(r.current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['a']);
    expect(r.current.getShiftsForDate(D('2026-04-16'))).toEqual([]);
  });

  it('spills an overnight shift into the NEXT day only when continuations are asked for', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'night', shift_date: '2026-04-15', start_time: '22:00', end_time: '06:00' }),
    ]);
    const r = render();

    // Default is includeContinuations: true
    expect(r.current.getShiftsForDate(D('2026-04-16')).map((s) => s.shift.id)).toEqual(['night']);
    expect(
      r.current.getShiftsForDate(D('2026-04-16'), { includeContinuations: false }),
    ).toEqual([]);
    // …and it still appears on its own start date either way.
    expect(
      r.current.getShiftsForDate(D('2026-04-15'), { includeContinuations: false }).map((s) => s.shift.id),
    ).toEqual(['night']);
  });

  it('does not spill a shift that ends exactly at midnight', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'clean', shift_date: '2026-04-15', start_time: '16:00', end_time: '00:00' }),
    ]);
    expect(render().current.getShiftsForDate(D('2026-04-16'))).toEqual([]);
  });

  it('spills across a MONTH boundary', () => {
    // The old code derived the previous day with date-fns; the index derives the
    // next day by hand, so the rollover deserves its own case.
    mockShifts.mockReturnValue([
      shift({ id: 'eom', shift_date: '2026-04-30', start_time: '22:00', end_time: '06:00' }),
    ]);
    expect(render().current.getShiftsForDate(D('2026-05-01')).map((s) => s.shift.id)).toEqual(['eom']);
  });

  it('preserves source order when a continuation interleaves with same-day shifts', () => {
    // Load bearing: MonthView renders `dayShifts.slice(0, 3)`, so which three
    // chips appear depends on this ordering.
    mockShifts.mockReturnValue([
      shift({ id: 'first-in-array', shift_date: '2026-04-15', start_time: '22:00', end_time: '06:00' }),
      shift({ id: 'second-in-array', shift_date: '2026-04-16' }),
    ]);
    expect(render().current.getShiftsForDate(D('2026-04-16')).map((s) => s.shift.id)).toEqual([
      'first-in-array',
      'second-in-array',
    ]);
  });
});

describe('useMyRoster — visibility and scope', () => {
  it('hides S3 (published, assigned, awaiting acceptance) — those live in the offers modal', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'offer', shift_date: '2026-04-15', lifecycle_status: 'Published', assignment_status: 'assigned', assignment_outcome: null }),
      shift({ id: 'real', shift_date: '2026-04-15' }),
    ]);
    expect(render().current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['real']);
  });

  it('filters by org, department and sub-department when a scope is passed', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'in', shift_date: '2026-04-15' }),
      shift({ id: 'other-org', shift_date: '2026-04-15', organization_id: 'org-2' }),
      shift({ id: 'other-dept', shift_date: '2026-04-15', department_id: 'dept-2' }),
      shift({ id: 'other-sub', shift_date: '2026-04-15', sub_department_id: 'sub-2' }),
    ]);
    const scope = { org_ids: ['org-1'], dept_ids: ['dept-1'], subdept_ids: ['sub-1'] };
    expect(render(scope).current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['in']);
  });

  it('keeps department-level shifts (null sub-department) inside a sub-department scope', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'dept-level', shift_date: '2026-04-15', sub_department_id: null }),
    ]);
    const scope = { org_ids: ['org-1'], dept_ids: ['dept-1'], subdept_ids: ['sub-1'] };
    expect(render(scope).current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['dept-level']);
  });

  it('falls back to the org context only, and stays relaxed when there is no org', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'mine', shift_date: '2026-04-15' }),
      shift({ id: 'theirs', shift_date: '2026-04-15', organization_id: 'org-2' }),
    ]);

    mockOrg.mockReturnValue({ organizationId: 'org-1', departmentId: null, subDepartmentId: null });
    expect(render(null).current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['mine']);

    // No scope AND no org context: show everything rather than hiding the roster.
    mockOrg.mockReturnValue({ organizationId: null, departmentId: null, subDepartmentId: null });
    expect(render(null).current.getShiftsForDate(D('2026-04-15')).map((s) => s.shift.id)).toEqual(['mine', 'theirs']);
  });

  it('maps the four fixed roster groups, and falls back for anything else', () => {
    mockShifts.mockReturnValue([
      shift({ id: 'c', shift_date: '2026-04-15', group_type: 'convention_centre' }),
      shift({ id: 'x', shift_date: '2026-04-15', group_type: 'something_else' }),
    ]);
    const got = render().current.getShiftsForDate(D('2026-04-15'));
    expect(got[0]).toMatchObject({ groupName: 'Convention', groupColor: 'convention', subGroupName: 'Stage' });
    expect(got[1]).toMatchObject({ groupName: 'General', groupColor: 'default' });
  });
});

describe('useMyRoster — referential stability', () => {
  it('returns the SAME array for repeated lookups of one day', () => {
    // This is the property the month grid's memos rely on: three calls per cell
    // must not produce three different arrays.
    mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
    const r = render();
    expect(r.current.getShiftsForDate(D('2026-04-15'))).toBe(r.current.getShiftsForDate(D('2026-04-15')));
  });

  it('returns the same empty array for every day with no shifts', () => {
    mockShifts.mockReturnValue([]);
    const r = render();
    expect(r.current.getShiftsForDate(D('2026-04-01'))).toBe(r.current.getShiftsForDate(D('2026-04-20')));
  });

  it('keeps getShiftsForDate identity across a re-render with unchanged data', () => {
    mockShifts.mockReturnValue([shift({ id: 'a', shift_date: '2026-04-15' })]);
    const { result, rerender } = renderHook(() => useMyRoster('month' as any, D('2026-04-15'), undefined));
    const before = result.current.getShiftsForDate;
    rerender();
    expect(result.current.getShiftsForDate).toBe(before);
  });
});
