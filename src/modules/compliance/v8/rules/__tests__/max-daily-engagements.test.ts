import { describe, it, expect } from 'vitest';
import { maxDailyEngagementsRule } from '../max-daily-engagements';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

// Three separate same-day engagements (well within the 12h spread).
function threeSameDay(overrides = {}) {
  return [
    buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '09:00', ...overrides }),
    buildShift({ date: '2026-06-01', start_time: '11:00', end_time: '13:00', ...overrides }),
    buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '17:00', ...overrides }),
  ];
}

describe('maxDailyEngagementsRule (clause 35.4(f))', () => {
  it('blocks a casual with 3 engagements on one day', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: threeSameDay(),
    });
    const hits = maxDailyEngagementsRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_MAX_DAILY_ENGAGEMENTS');
    expect(hits[0].status).toBe('BLOCKING');
    expect(hits[0].blocking).toBe(true);
    expect(hits[0].calculation?.engagement_count).toBe(3);
  });

  it('allows a casual with exactly 2 engagements on one day', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '11:00' }),
        buildShift({ date: '2026-06-01', start_time: '13:00', end_time: '17:00' }),
      ],
    });
    expect(maxDailyEngagementsRule(ctx)).toEqual([]);
  });

  it('does NOT apply to full-time (clause 35.4(f) is casual-only)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME' },
      shifts: threeSameDay(),
    });
    expect(maxDailyEngagementsRule(ctx)).toEqual([]);
  });

  it('does NOT apply to part-time or flexi (owned by clause 39 split-shift)', () => {
    resetIdCounter();
    for (const contract_type of ['PART_TIME', 'FLEXI_PART_TIME'] as const) {
      const ctx = buildContext({ employee: { contract_type }, shifts: threeSameDay() });
      expect(maxDailyEngagementsRule(ctx)).toEqual([]);
    }
  });

  it('exempts training shifts from the count (2 work + 1 training is fine)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '09:00' }),
        buildShift({ date: '2026-06-01', start_time: '11:00', end_time: '13:00' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '17:00', is_training: true }),
      ],
    });
    expect(maxDailyEngagementsRule(ctx)).toEqual([]);
  });

  it('still blocks when 3 non-training shifts sit alongside a training shift', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: [
        ...threeSameDay(),
        buildShift({ date: '2026-06-01', start_time: '19:00', end_time: '21:00', is_training: true }),
      ],
    });
    const hits = maxDailyEngagementsRule(ctx);
    expect(hits).toHaveLength(1);
    // The training shift is excluded from both the count and affected_shifts.
    expect(hits[0].calculation?.engagement_count).toBe(3);
    expect(hits[0].affected_shifts).toHaveLength(3);
  });

  it('does not count shifts on different days together', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '11:00' }),
        buildShift({ date: '2026-06-02', start_time: '07:00', end_time: '11:00' }),
        buildShift({ date: '2026-06-03', start_time: '07:00', end_time: '11:00' }),
      ],
    });
    expect(maxDailyEngagementsRule(ctx)).toEqual([]);
  });

  it('never re-flags a day of pure committed history (all non-candidate)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: threeSameDay({ is_candidate: false }),
    });
    expect(maxDailyEngagementsRule(ctx)).toEqual([]);
  });

  it('flags when a candidate pushes an existing 2-shift day to 3', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '09:00', is_candidate: false }),
        buildShift({ date: '2026-06-01', start_time: '11:00', end_time: '13:00', is_candidate: false }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '17:00', is_candidate: true }),
      ],
    });
    expect(maxDailyEngagementsRule(ctx)).toHaveLength(1);
  });
});
