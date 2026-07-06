import { describe, it, expect } from 'vitest';
import { maxWorkdayLimitsRule } from '../consecutive-days';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('maxWorkdayLimitsRule', () => {
  it('passes when no shifts are present', () => {
    expect(maxWorkdayLimitsRule(buildContext())).toEqual([]);
  });

  it('passes for 6 consecutive days (standard cap)', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(6, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.find(h => h.rule_id?.includes('STREAK') || h.rule_id?.includes('CONSECUTIVE'))).toBeUndefined();
  });

  it('does NOT apply a streak cap to a standard contract (20-in-28 governs)', () => {
    // Policy locked 2026-07-05: FT/PT/casual have no arbitrary streak cap; only
    // the 20-in-28 rule limits them. 7 consecutive days is well under 20.
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(7, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.some(h => h.rule_id === 'V8_STREAK_LIMIT')).toBe(false);
    expect(hits.some(h => h.blocking)).toBe(false);
  });

  it('allows up to 10 consecutive days for FLEXI_PART_TIME', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FLEXI_PART_TIME' },
      shifts: buildConsecutiveShifts(10, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    const streakHits = hits.filter(h => h.rule_id?.includes('STREAK') || h.rule_id?.includes('CONSECUTIVE'));
    expect(streakHits).toEqual([]);
  });

  it('blocks 11 consecutive days for FLEXI_PART_TIME (cl. 35.3(g))', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FLEXI_PART_TIME' },
      shifts: buildConsecutiveShifts(11, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.some(h => h.rule_id === 'V8_STREAK_LIMIT' && h.blocking)).toBe(true);
  });

  it('blocks 21 days inside a 28-day window', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: buildConsecutiveShifts(21, '2026-06-01'),
    });
    const hits = maxWorkdayLimitsRule(ctx);
    expect(hits.some(h => h.blocking)).toBe(true);
  });
});
