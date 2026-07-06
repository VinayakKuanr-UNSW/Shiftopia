import { describe, it, expect } from 'vitest';
import { ordinaryHoursAvgRule } from '../ordinary-hours-avg';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('ordinaryHoursAvgRule', () => {
  it('returns no hits when there are no shifts', () => {
    expect(ordinaryHoursAvgRule(buildContext())).toEqual([]);
  });

  it('does not apply to CASUAL employees', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: buildConsecutiveShifts(28, '2026-06-01', {
        start_time: '08:00',
        end_time: '20:00',
      }),
    });
    expect(ordinaryHoursAvgRule(ctx)).toEqual([]);
  });

  it('passes a modest 5-day fortnight at 38h total', () => {
    // 5 days × 7h36m = 38 hours total — well under any rolling-window limit
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(5, '2026-06-01', {
        start_time: '09:00',
        end_time: '16:36',
      }),
    });
    expect(ordinaryHoursAvgRule(ctx)).toEqual([]);
  });

  it('flags an extreme over-average across consecutive weeks (BLOCKING)', () => {
    // 28 consecutive 10h days = 280h far above the 152h 4-week cycle limit
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(28, '2026-06-01', {
        start_time: '08:00',
        end_time: '18:00',
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.rule_id).toBe('V8_ORD_HOURS_AVG');
  });

  it('a single 45h week that averages out over the cycle WARNS, does not block', () => {
    // Week 1: 5 × 9h = 45h. Weeks 2-4: nothing. 4-week avg = 45/4 ≈ 11.25h — legal.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(5, '2026-06-01', {
        start_time: '08:00',
        end_time: '17:00', // 9h
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    // No 28-day breach (only 45h in the whole cycle) => nothing blocks.
    expect(hits.some(h => h.blocking)).toBe(false);
    // But the 7-day rate (45h) exceeds 38h/week => a peak warning is surfaced.
    expect(hits.some(h => h.rule_id === 'V8_ORD_HOURS_PEAK' && h.status === 'WARNING')).toBe(true);
  });

  it('rostering a 20h-contracted part-timer above contract WARNS, does not block', () => {
    // 5 × 6h = 30h in week 1 for a 20h/week contract. Under 38h (no block), but
    // above the contracted 20h => informational warning (cl. 12.3(d)).
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME', contracted_weekly_hours: 20 },
      shifts: buildConsecutiveShifts(5, '2026-06-01', {
        start_time: '09:00',
        end_time: '15:00', // 6h
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    expect(hits.some(h => h.blocking)).toBe(false);
    expect(hits.some(h => h.rule_id === 'V8_ORD_HOURS_CONTRACTED' && h.status === 'WARNING')).toBe(true);
  });
});
