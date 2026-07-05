// =============================================================================
// abuse-logic (weekly cap + pairwise) and solver-fold unit tests
//
// Run: npx vitest run --config supabase/functions/auto-approve-swaps/vitest.config.ts
// =============================================================================

import { describe, it, expect } from 'vitest';

import {
  countAutoApprovals,
  exceedsWeeklyCap,
  pairCount,
  pairKey,
  type DecisionPartyRow,
} from '../abuse-logic.ts';
import {
  buildSolverResult,
  normalizeCompliance,
  toSolverSignals,
  type PartyResult,
} from '../solver-fold.ts';

const row = (requester_id: string | null, target_id: string | null): DecisionPartyRow =>
  ({ requester_id, target_id });

function party(over: Partial<PartyResult> = {}): PartyResult {
  return {
    employee_id: over.employee_id ?? 'emp',
    received_shift_id: over.received_shift_id ?? 'shift',
    excluded_shift_id: over.excluded_shift_id ?? null,
    status: over.status ?? 'passed',
    violations: over.violations ?? [],
    warnings: over.warnings ?? [],
  };
}

// =============================================================================
// WEEKLY CAP (max_auto_per_employee_per_week)
// =============================================================================

describe('weekly cap: countAutoApprovals + exceedsWeeklyCap', () => {
  it('attributes one count to BOTH parties of each committed auto-approval', () => {
    const counts = countAutoApprovals([row('A', 'B'), row('A', 'C'), row('D', 'A')]);
    expect(counts.get('A')).toBe(3);
    expect(counts.get('B')).toBe(1);
    expect(counts.get('C')).toBe(1);
    expect(counts.get('D')).toBe(1);
  });

  it('ignores null party columns (giveaways without a counterpart)', () => {
    const counts = countAutoApprovals([row('A', null), row(null, null)]);
    expect(counts.get('A')).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('under the cap ⇒ not limited', () => {
    const counts = countAutoApprovals([row('A', 'B'), row('A', 'C')]); // A=2
    expect(exceedsWeeklyCap(counts, ['A', 'B'], 3)).toBe(false);
  });

  it('AT the cap ⇒ limited (the cap-th+1 approval is downgraded)', () => {
    const counts = countAutoApprovals([row('A', 'B'), row('A', 'C'), row('A', 'D')]); // A=3
    expect(exceedsWeeklyCap(counts, ['A', 'X'], 3)).toBe(true);
  });

  it('either party at the cap trips the brake', () => {
    const counts = countAutoApprovals([row('B', 'C'), row('B', 'D'), row('B', 'E')]); // B=3
    expect(exceedsWeeklyCap(counts, ['A', 'B'], 3)).toBe(true);
  });

  it('cap of 0 means "never auto without review", even with zero history', () => {
    expect(exceedsWeeklyCap(new Map(), ['A'], 0)).toBe(true);
  });

  it('employees with no history do not trip a positive cap', () => {
    expect(exceedsWeeklyCap(new Map(), ['A', 'B'], 1)).toBe(false);
  });
});

describe('pairwise favoritism: pairCount', () => {
  it('counts the unordered pair in both directions', () => {
    const rows = [row('A', 'B'), row('B', 'A'), row('A', 'C')];
    expect(pairCount(rows, 'A', 'B')).toBe(2);
    expect(pairCount(rows, 'B', 'A')).toBe(2);
    expect(pairCount(rows, 'A', 'C')).toBe(1);
  });

  it('pairKey is order-insensitive', () => {
    expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'));
  });
});

// =============================================================================
// SOLVER FOLD — fail-closed
// =============================================================================

describe('solver-fold: buildSolverResult', () => {
  it('both passed ⇒ PASS / feasible', () => {
    const r = buildSolverResult(party(), party({ employee_id: 'B' }));
    expect(r.verdict).toBe('PASS');
    expect(r.feasible).toBe(true);
  });

  it('any warned (none violated) ⇒ WARNING, still feasible', () => {
    const r = buildSolverResult(party({ status: 'warned', warnings: ['near cap'] }), party());
    expect(r.verdict).toBe('WARNING');
    expect(r.feasible).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it('any violated ⇒ BLOCKING / infeasible', () => {
    const r = buildSolverResult(party(), party({ status: 'violated', violations: ['overlap'] }));
    expect(r.verdict).toBe('BLOCKING');
    expect(r.feasible).toBe(false);
    expect(r.violations[0].messages).toContain('overlap');
  });

  it('unavailable is fail-closed ⇒ BLOCKING', () => {
    const r = buildSolverResult(party({ status: 'unavailable' }), party());
    expect(r.verdict).toBe('BLOCKING');
    expect(r.violations[0].messages[0]).toMatch(/unavailable/);
  });

  it('ZERO evaluated parties ⇒ BLOCKING (nothing checked = nothing approvable)', () => {
    const r = buildSolverResult(null, null);
    expect(r.verdict).toBe('BLOCKING');
    expect(r.feasible).toBe(false);
    expect(r.violations[0].messages[0]).toMatch(/no party was compliance-evaluated/);
  });

  it('single-party giveaway is folded from just party B', () => {
    const ok = buildSolverResult(null, party({ employee_id: 'B' }));
    expect(ok.verdict).toBe('PASS');
    const bad = buildSolverResult(null, party({ employee_id: 'B', status: 'violated' }));
    expect(bad.verdict).toBe('BLOCKING');
  });
});

describe('solver-fold: normalizeCompliance (fail-closed on garbage)', () => {
  it('valid statuses pass through', () => {
    expect(normalizeCompliance({ status: 'passed' }).status).toBe('passed');
    expect(normalizeCompliance({ status: 'warned', warnings: ['w'] }).warnings).toEqual(['w']);
  });

  it('unknown status / malformed payload ⇒ unavailable', () => {
    expect(normalizeCompliance({ status: 'ok' }).status).toBe('unavailable');
    expect(normalizeCompliance(null).status).toBe('unavailable');
    expect(normalizeCompliance(undefined).status).toBe('unavailable');
    expect(normalizeCompliance('nonsense').status).toBe('unavailable');
    expect(normalizeCompliance({ violations: 'not-an-array' }).violations).toEqual([]);
  });
});

describe('solver-fold: toSolverSignals', () => {
  it('BLOCKING feeds the always-on fatigue gate', () => {
    const r = buildSolverResult(party({ status: 'violated', violations: ['rest 11h'] }), party());
    const s = toSolverSignals(r);
    expect(s.fatigue_blocking).toBe(true);
    expect(s.fatigue_hits).toContain('rest 11h');
  });

  it('warnings feed the warning count + overtime signal', () => {
    const r = buildSolverResult(party({ status: 'warned', warnings: ['a', 'b'] }), party());
    const s = toSolverSignals(r);
    expect(s.warning_count).toBe(2);
    expect(s.overtime_warning).toBe(true);
    expect(s.fatigue_blocking).toBe(false);
  });
});
