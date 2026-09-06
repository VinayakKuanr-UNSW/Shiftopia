import { describe, it, expect } from 'vitest';
import { ordinaryHoursAvgRule } from '../ordinary-hours-avg';
import { buildContext, buildConsecutiveShifts, resetIdCounter } from './_helpers';

describe('ordinaryHoursAvgRule', () => {
  it('returns no hits when there are no shifts', () => {
    expect(ordinaryHoursAvgRule(buildContext())).toEqual([]);
  });

  /**
   * cl 35.4(a) caps casual ordinary hours in the same words 35.1(a) uses for a
   * full-timer. The exemption this replaces was added on 2026-07-05 to stop a
   * wall of false badges — but those came from stacking every rung of the
   * ladder as a rolling window, not from casuals being in scope, so it was a
   * fix aimed at the wrong divergence.
   */
  it('applies to CASUAL employees — cl 35.4(a) caps them too', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      // Inside ONE four-week cycle: 2026-05-18 opens it. 28 × 12h = 336h.
      shifts: buildConsecutiveShifts(28, '2026-05-18', {
        start_time: '08:00',
        end_time: '20:00',
      }),
    });
    const blocking = ordinaryHoursAvgRule(ctx).find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.rule_id).toBe('V8_ORD_HOURS_AVG');
    // No clause declares a cycle length for casuals — there is no 12.5
    // counterpart to 12.2(b) — so they take the four-week rung, the most
    // permissive the Agreement enumerates.
    expect(blocking!.calculation?.limit).toBe(152);
  });

  it('leaves a CASUAL inside the ceiling alone', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: buildConsecutiveShifts(12, '2026-05-18', {
        start_time: '08:00',
        end_time: '20:00',
      }),   // 12 × 12h = 144h < 152h
    });
    expect(ordinaryHoursAvgRule(ctx).find(h => h.blocking)).toBeUndefined();
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

  it('flags an extreme over-average WITHIN one cycle (BLOCKING)', () => {
    // 2026-05-18 opens a four-week cycle (anchor 2024-01-01), so all 28 of
    // these 10h days land in it: 280h against the 152h ceiling.
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(28, '2026-05-18', {
        start_time: '08:00',
        end_time: '18:00',
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    const blocking = hits.find(h => h.blocking);
    expect(blocking).toBeDefined();
    expect(blocking!.rule_id).toBe('V8_ORD_HOURS_AVG');
  });

  /**
   * The behaviour change in the move from rolling windows to anchored cycles,
   * pinned deliberately.
   *
   * The identical 28-day block shifted two weeks later straddles the boundary
   * between cycles 31 and 32, putting 140h in each — under the 152h ceiling
   * both times. cl 35.x(a) caps the CYCLE, not every 28 consecutive days, so
   * this is not an ordinary-hours breach.
   *
   * It is still an unlawful roster, and it is still blocked: 28 consecutive
   * worked days breaches cl 35.1(e)'s 20-in-28, which `V8_20_IN_28` in
   * consecutive-days.ts enforces as BLOCKING. The rolling window here was doing
   * that rule's job and calling it by the wrong clause.
   */
  it('does NOT flag the same block straddling two cycles — that shape is V8_20_IN_28', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME', contracted_weekly_hours: 38 },
      shifts: buildConsecutiveShifts(28, '2026-06-01', {
        start_time: '08:00',
        end_time: '18:00',
      }),
    });
    const hits = ordinaryHoursAvgRule(ctx);
    expect(hits.find(h => h.blocking)).toBeUndefined();
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
