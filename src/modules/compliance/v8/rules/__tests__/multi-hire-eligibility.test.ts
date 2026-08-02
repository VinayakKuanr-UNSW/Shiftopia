import { describe, it, expect } from 'vitest';
import { multiHireEligibilityRule } from '../multi-hire-eligibility';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

describe('multiHireEligibilityRule (clause 13.1(f), audit M-1)', () => {
  it('warns when a same-day MULTI_HIRE pair shares the same role', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
      ],
    });
    const hits = multiHireEligibilityRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MULTI_HIRE_ELIGIBILITY');
    expect(hits[0].status).toBe('WARNING');
    expect(hits[0].blocking).toBe(false);
  });

  it('does NOT warn when the pair is in different roles (genuinely eligible)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE', role_id: 'r2' }),
      ],
    });
    expect(multiHireEligibilityRule(ctx)).toEqual([]);
  });

  it('does NOT warn on an ordinary (non-multi-hire) same-role split-shift pair', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', role_id: 'r1' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', role_id: 'r1' }),
      ],
    });
    expect(multiHireEligibilityRule(ctx)).toEqual([]);
  });

  it('does NOT warn when role_id is missing on either side (cannot compare)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', shift_type: 'MULTI_HIRE' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
      ],
    });
    expect(multiHireEligibilityRule(ctx)).toEqual([]);
  });

  it('ignores cross-day pairs', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
        buildShift({ date: '2026-06-02', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE', role_id: 'r1' }),
      ],
    });
    expect(multiHireEligibilityRule(ctx)).toEqual([]);
  });

  it('never re-flags pure committed history (both sides non-candidate)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', shift_type: 'MULTI_HIRE', role_id: 'r1', is_candidate: false }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE', role_id: 'r1', is_candidate: false }),
      ],
    });
    expect(multiHireEligibilityRule(ctx)).toEqual([]);
  });
});
