import { describe, it, expect } from 'vitest';
import { leaveConflictRule } from '../leave-conflict';
import { buildContext, buildShift, buildEmployee } from './_helpers';

describe('leaveConflictRule (V8_LEAVE_CONFLICT — audit F1)', () => {
  it('is silent when the employee has no leave data (un-plumbed callers)', () => {
    const ctx = buildContext({
      employee: buildEmployee(),
      shifts: [buildShift({ date: '2026-07-06', is_candidate: true })],
    });
    expect(leaveConflictRule(ctx)).toEqual([]);
    const ctxEmpty = buildContext({
      employee: buildEmployee({ leave_days: [] }),
      shifts: [buildShift({ date: '2026-07-06', is_candidate: true })],
    });
    expect(leaveConflictRule(ctxEmpty)).toEqual([]);
  });

  it('BLOCKS a candidate shift on an approved-leave date', () => {
    const shift = buildShift({ id: 's1', date: '2026-07-07', is_candidate: true });
    const ctx = buildContext({
      employee: buildEmployee({ leave_days: ['2026-07-06', '2026-07-07'] }),
      shifts: [shift],
    });
    const hits = leaveConflictRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      rule_id: 'V8_LEAVE_CONFLICT',
      status: 'BLOCKING',
      blocking: true,
      affected_shifts: ['s1'],
    });
  });

  it('passes a candidate shift outside the leave dates', () => {
    const ctx = buildContext({
      employee: buildEmployee({ leave_days: ['2026-07-06'] }),
      shifts: [buildShift({ date: '2026-07-08', is_candidate: true })],
    });
    expect(leaveConflictRule(ctx)).toEqual([]);
  });

  it('never re-validates history: is_candidate === false shifts are skipped', () => {
    const ctx = buildContext({
      employee: buildEmployee({ leave_days: ['2026-07-06'] }),
      shifts: [
        buildShift({ id: 'history', date: '2026-07-06', is_candidate: false }),
        buildShift({ id: 'cand', date: '2026-07-09', is_candidate: true }),
      ],
    });
    expect(leaveConflictRule(ctx)).toEqual([]);
  });

  it('treats unflagged shifts as candidates (legacy swap-path tolerance)', () => {
    const ctx = buildContext({
      employee: buildEmployee({ leave_days: ['2026-07-06'] }),
      shifts: [buildShift({ id: 'legacy', date: '2026-07-06' })],
    });
    const hits = leaveConflictRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].affected_shifts).toEqual(['legacy']);
  });

  it('matches on shift_date alias when date is empty', () => {
    const shift = buildShift({ id: 'alias', is_candidate: true });
    (shift as { date: string }).date = '';
    shift.shift_date = '2026-07-06';
    const ctx = buildContext({
      employee: buildEmployee({ leave_days: ['2026-07-06'] }),
      shifts: [shift],
    });
    expect(leaveConflictRule(ctx)).toHaveLength(1);
  });
});
