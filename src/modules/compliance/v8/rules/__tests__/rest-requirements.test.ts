import { describe, it, expect } from 'vitest';
import { minRestGapRule } from '../rest-requirements';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

describe('minRestGapRule (clause 40 — cross-day only)', () => {
  it('passes when only one shift is present', () => {
    const ctx = buildContext({ shifts: [buildShift()] });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('passes when the cross-day gap is exactly 10 hours', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '14:00' }),
        buildShift({ date: '2026-06-02', start_time: '00:00', end_time: '08:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('blocks when the CROSS-DAY gap is 9h 59m', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' }),
        buildShift({ date: '2026-06-02', start_time: '05:59', end_time: '10:00' }),
      ],
    });
    const hits = minRestGapRule(ctx);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].rule_id).toBe('V8_MIN_REST_GAP');
    expect(hits[0].status).toBe('BLOCKING');
  });

  it('does NOT block same-start-day pairs (split-shift / spread territory, not clause 40)', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        // A 5h intraday gap is NOT a rest-gap violation — clause 40 is cross-day.
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '11:00' }),
        buildShift({ date: '2026-06-01', start_time: '16:00', end_time: '20:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('does not block when shifts are more than 1 calendar day apart', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '16:00' }),
        buildShift({ date: '2026-06-05', start_time: '06:00', end_time: '14:00' }),
      ],
    });
    expect(minRestGapRule(ctx)).toEqual([]);
  });

  it('honours the 8h written-agreement config (clause 40.2)', () => {
    resetIdCounter();
    const shifts = [
      buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' }), // ends 20:00
      buildShift({ date: '2026-06-02', start_time: '04:00', end_time: '10:00' }), // 8h later
    ];
    // Default 10h → blocks (only 8h rest)
    expect(minRestGapRule(buildContext({ shifts })).length).toBeGreaterThanOrEqual(1);
    // 8h agreement → passes
    expect(
      minRestGapRule(buildContext({ shifts, config: { min_rest_gap_minutes: 480 } })),
    ).toEqual([]);
  });

  it('reports relaxed mode in the calculation when configured to 8h', () => {
    resetIdCounter();
    const ctx = buildContext({
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' }),
        buildShift({ date: '2026-06-02', start_time: '02:00', end_time: '08:00' }), // 6h gap < 8h
      ],
      config: { min_rest_gap_minutes: 480 },
    });
    const hits = minRestGapRule(ctx);
    expect(hits[0].calculation?.rest_gap_mode).toBe('relaxed');
    expect(hits[0].calculation?.limit).toBe(8);
  });

  it('requires only an 8h break for multi-hire engagements (clause 40.3)', () => {
    resetIdCounter();
    const shifts = [
      buildShift({ date: '2026-06-01', start_time: '08:00', end_time: '20:00' }),
      buildShift({ date: '2026-06-02', start_time: '04:00', end_time: '10:00', shift_type: 'MULTI_HIRE' }), // 8h gap
    ];
    // Even under the default 10h minimum, a multi-hire pair passes at 8h.
    expect(minRestGapRule(buildContext({ shifts }))).toEqual([]);
  });
});
