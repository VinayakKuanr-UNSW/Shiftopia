import { describe, it, expect } from 'vitest';
import { splitShiftRule } from '../split-shift';
import { buildContext, buildShift, resetIdCounter } from './_helpers';

// Two same-day engagements with a >3h gap (07-10 then 15-18 → 5h gap).
function sameDayWideGap() {
  return [
    buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00' }),
    buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00' }),
  ];
}

describe('splitShiftRule (clause 39)', () => {
  it('warns on a >3h same-day gap for a PART_TIME employee', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: sameDayWideGap(),
    });
    const hits = splitShiftRule(ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].rule_id).toBe('V8_SPLIT_SHIFT');
    expect(hits[0].status).toBe('WARNING');
    expect(hits[0].blocking).toBe(false);
  });

  it('warns for FLEXI_PART_TIME too', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FLEXI_PART_TIME' },
      shifts: sameDayWideGap(),
    });
    expect(splitShiftRule(ctx)).toHaveLength(1);
  });

  it('does NOT warn when the same-day gap is within 3h (compliant split shift)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '11:00' }),
        buildShift({ date: '2026-06-01', start_time: '13:00', end_time: '17:00' }), // 2h gap
      ],
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('does not apply to casuals (clause 28.4)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'CASUAL' },
      shifts: sameDayWideGap(),
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('does not apply to full-time (clause 39.1 lists PT/flexi only)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'FULL_TIME' },
      shifts: sameDayWideGap(),
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('ignores cross-day pairs (those are the rest-gap rule)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00' }),
        buildShift({ date: '2026-06-02', start_time: '15:00', end_time: '18:00' }),
      ],
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('excludes multi-hire engagements (clause 39.4)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00' }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', shift_type: 'MULTI_HIRE' }),
      ],
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('never re-flags pure committed history (both sides non-candidate)', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', is_candidate: false }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', is_candidate: false }),
      ],
    });
    expect(splitShiftRule(ctx)).toEqual([]);
  });

  it('does flag when a candidate is added against existing history', () => {
    resetIdCounter();
    const ctx = buildContext({
      employee: { contract_type: 'PART_TIME' },
      shifts: [
        buildShift({ date: '2026-06-01', start_time: '07:00', end_time: '10:00', is_candidate: false }),
        buildShift({ date: '2026-06-01', start_time: '15:00', end_time: '18:00', is_candidate: true }),
      ],
    });
    expect(splitShiftRule(ctx)).toHaveLength(1);
  });
});
