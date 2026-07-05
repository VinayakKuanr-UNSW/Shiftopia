import { describe, it, expect } from 'vitest';
import { noOverlapRule } from '../structural-rules';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

describe('noOverlapRule', () => {
  it('passes when only one shift is present', () => {
    const ctx = buildContext({ shifts: [buildShift()] });
    expect(noOverlapRule(ctx)).toEqual([]);
  });

  it('passes when shifts are on different days', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01' }),
        buildShift({ date: '2026-06-02' }),
      ],
    });
    expect(noOverlapRule(ctx)).toEqual([]);
  });

  it('passes when shifts are back-to-back (no overlap)', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '12:00' }),
        buildShift({ date: '2026-06-01', start_time: '12:00', end_time: '17:00' }),
      ],
    });
    expect(noOverlapRule(ctx)).toEqual([]);
  });

  it('blocks on partial overlap on the same day', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '09:00', end_time: '13:00' }),
        buildShift({ date: '2026-06-01', start_time: '12:00', end_time: '17:00' }),
      ],
    });
    const hits = noOverlapRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_NO_OVERLAP');
    expect(hits[0].status).toBe('BLOCKING');
    expect(hits[0].blocking).toBe(true);
    expect(hits[0].affected_shifts).toHaveLength(2);
  });

  it('blocks on fully contained (nested) overlap', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' }),
        buildShift({ date: '2026-06-01', start_time: '10:00', end_time: '14:00' }),
      ],
    });
    const hits = noOverlapRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe('BLOCKING');
  });
});

// Minimum-duration enforcement moved wholesale into minEngagementRule
// (V8_MIN_ENGAGEMENT). See ./min-engagement.test.ts.
