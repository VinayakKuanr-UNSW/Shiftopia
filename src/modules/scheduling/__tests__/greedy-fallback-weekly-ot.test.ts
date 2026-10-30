/**
 * `buildGreedyFallbackPriorOrdinaryMap` — compliance audit finding
 * (2026-08-02): the AutoScheduler's own pre-commit cost estimate never
 * threaded cl 42 weekly overtime into the greedy-fallback re-estimate, even
 * though the same logic was already wired into the post-commit roster
 * projection pipeline. A manager reviewing a fallback-path preview could see
 * a "Total Cost" that understated real weekly overtime.
 *
 * Mocking strategy mirrors auto-scheduler-commit.test.ts / security-rate-
 * resolution.test.ts: these modules drag in Supabase/optimizer internals at
 * import time and must be stubbed so the controller module can load.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/scheduling/validation', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentValidator: { simulate: vi.fn() } };
});
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() } };
});
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', () => ({
    rosterFetcher: { fetchExistingRoster: vi.fn(), fetchAvailability: vi.fn() },
    durationMinutes: (start: string, end: string) => {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins <= 0) mins += 1440;
        return mins;
    },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({
    auditor: { audit: vi.fn() },
}));

import { buildGreedyFallbackPriorOrdinaryMap, estimateGreedyFallbackCost } from '../auto-scheduler.controller';
import { resolveRateSet } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';
import type { EmployeeMeta, ShiftMeta } from '../optimizer/solution-parser';
import type { ValidatedProposal } from '../types';
import type { ExistingShiftRef } from '../types';

function proposal(o: Partial<ValidatedProposal>): ValidatedProposal {
  return {
    shiftId: 's1', employeeId: 'e1', employeeName: 'Test', shiftDate: '2026-07-06',
    startTime: '09:00', endTime: '17:00', optimizerCost: 0, employmentType: 'Full-Time',
    complianceStatus: 'PASS', violations: [], passing: true,
    ...o,
  };
}

function existingShift(o: Partial<ExistingShiftRef>): ExistingShiftRef {
  return { id: 'x1', shift_date: '2026-07-06', start_time: '09:00', end_time: '17:00', duration_minutes: 480, unpaid_break_minutes: 0, ...o };
}

describe('buildGreedyFallbackPriorOrdinaryMap', () => {
  it('accumulates prior ordinary hours across a FT member\'s newly proposed shifts in the same ISO week', () => {
    const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    const proposals = dates.map((d, i) => proposal({ shiftId: `s${i}`, shiftDate: d }));

    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, new Map());

    // 5 x 8h weekday shifts Mon-Fri: prior for each is the running total before it.
    expect(prior.get('s0')).toBe(0);
    expect(prior.get('s1')).toBe(8);
    expect(prior.get('s2')).toBe(16);
    expect(prior.get('s3')).toBe(24);
    expect(prior.get('s4')).toBe(32);
  });

  it('seeds the running total with the employee\'s EXISTING committed roster for the same week', () => {
    const existingRoster = new Map<string, ExistingShiftRef[]>([
      ['e1', [existingShift({ id: 'x1', shift_date: '2026-07-06', start_time: '09:00', end_time: '17:00' })]], // 8h Monday, already committed
    ]);
    const proposals = [proposal({ shiftId: 's1', shiftDate: '2026-07-07' })]; // Tuesday, newly proposed

    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, existingRoster);
    expect(prior.get('s1')).toBe(8); // sees the existing Monday shift's 8h
  });

  it('does not accumulate across different ISO weeks', () => {
    const proposals = [
      proposal({ shiftId: 's1', shiftDate: '2026-07-06' }), // week 1
      proposal({ shiftId: 's2', shiftDate: '2026-07-13' }), // week 2
    ];
    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, new Map());
    expect(prior.get('s1')).toBe(0);
    expect(prior.get('s2')).toBe(0);
  });

  it('excludes casual proposals entirely (ambiguous under the EA)', () => {
    const proposals = [
      proposal({ shiftId: 's1', shiftDate: '2026-07-06', employmentType: 'Casual' }),
      proposal({ shiftId: 's2', shiftDate: '2026-07-07', employmentType: 'Casual' }),
    ];
    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, new Map());
    expect(prior.has('s1')).toBe(false);
    expect(prior.has('s2')).toBe(false);
  });

  it('excludes non-passing proposals from the accumulation', () => {
    const proposals = [
      proposal({ shiftId: 's1', shiftDate: '2026-07-06', passing: false }),
      proposal({ shiftId: 's2', shiftDate: '2026-07-07' }),
    ];
    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, new Map());
    expect(prior.has('s1')).toBe(false);
    expect(prior.get('s2')).toBe(0); // s1 excluded, so nothing accrued before s2
  });

  it('never confuses two different employees\' shifts in the same week', () => {
    const proposals = [
      proposal({ shiftId: 's1', employeeId: 'e1', shiftDate: '2026-07-06' }),
      proposal({ shiftId: 's2', employeeId: 'e2', shiftDate: '2026-07-07' }),
    ];
    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, new Map());
    expect(prior.get('s1')).toBe(0);
    expect(prior.get('s2')).toBe(0); // e2's own week, unaffected by e1
  });

  // A meal break is not worked. Counting it as ordinary time pushed staff into
  // weekly overtime early and overstated the fallback's cost; the roster
  // pipeline (`netMinutesFromDTO`) has always netted it out.
  it('accrues hours net of the unpaid break, for existing and proposed shifts alike', () => {
    const existingRoster = new Map<string, ExistingShiftRef[]>([
      ['e1', [existingShift({ id: 'x1', shift_date: '2026-07-06', unpaid_break_minutes: 30 })]], // 8h gross
    ]);
    const proposals = [
      proposal({ shiftId: 's1', shiftDate: '2026-07-07' }),                     // 8h gross
      proposal({ shiftId: 's2', shiftDate: '2026-07-08' }),
    ];
    const shifts = [
      { id: 's1', shift_date: '2026-07-07', start_time: '09:00', end_time: '17:00', unpaid_break_minutes: 60 },
    ];

    const prior = buildGreedyFallbackPriorOrdinaryMap(proposals, existingRoster, shifts);

    expect(prior.get('s1')).toBe(7.5);   // Monday: 8h − 30m
    expect(prior.get('s2')).toBe(14.5);  // + Tuesday: 8h − 60m
  });
});

// The fallback once priced every shift at a flat $25/h: it passed
// `employee.remuneration_rate ?? 25`, nothing ever set remuneration_rate, and a
// supplied rate wins over the classification level in the cost engine.
describe('estimateGreedyFallbackCost', () => {
  const shift = { id: 's1', shift_date: '2026-07-07', start_time: '09:00', end_time: '17:00',
                  unpaid_break_minutes: 0, roleName: 'Usher' } as ShiftMeta;
  const casual = { id: 'e1', name: 'Test', contract_type: 'CASUAL' } as EmployeeMeta;

  it('prices from the employee\'s classification level, not a flat rate', () => {
    const level1 = estimateGreedyFallbackCost(shift, casual, { level: 1 }, 0);
    const level5 = estimateGreedyFallbackCost(shift, casual, { level: 5 }, 0);

    expect(level5).toBeGreaterThan(level1);
    // A Tuesday 09:00–17:00 has no penalty or allowance: 8 h at the casual rate.
    expect(level5).toBeCloseTo(8 * resolveRateSet('2026-07-07').wageRates.LEVEL_5.casual, 2);
  });
});
