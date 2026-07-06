// =============================================================================
// COMPLIANCE IS A HARD BLOCKER — invariant sweep
//
// Proves the requirement "be it live mode / shadow mode, at no point can we
// ignore compliance": for EVERY combination of policy knobs an operator can
// turn (auto_approve_warnings, confidence_min, rule modes incl. attempts to
// IGNORE the always-on rules), a BLOCKING / infeasible / unavailable /
// zero-party compliance verdict can NEVER produce AUTO_APPROVE.
//
// Shadow vs live is decided AFTER the matrix (sm_swap_auto_decide either
// suppresses or commits the same decision), so proving the matrix can't emit
// AUTO_APPROVE under a compliance failure covers both modes.
//
// Run: npx vitest run --config supabase/functions/auto-approve-swaps/vitest.config.ts
// =============================================================================

import { describe, it, expect } from 'vitest';

import { decide } from '../decision-matrix.ts';
import { evaluateEligibility, effectiveMode } from '../eligibility.ts';
import { buildSolverResult, toSolverSummary, type PartyResult } from '../solver-fold.ts';
import type { DecisionInput, EligibilityResult, RulePolicy } from '../types.ts';

// ── builders ─────────────────────────────────────────────────────────────────

function partyResult(over: Partial<PartyResult> = {}): PartyResult {
  return {
    employee_id: over.employee_id ?? 'emp-A',
    received_shift_id: over.received_shift_id ?? 'shift-x',
    excluded_shift_id: over.excluded_shift_id ?? null,
    status: over.status ?? 'passed',
    violations: over.violations ?? [],
    warnings: over.warnings ?? [],
  };
}

function cleanEligibility(over: Partial<EligibilityResult> = {}): EligibilityResult {
  return {
    outcomes: [],
    rejectVotes: [],
    reviewVotes: [],
    payrollDelta: { requesterDeltaPerHour: 0, offererDeltaPerHour: 0, estCostDelta: 0 },
    confidence: 1,
    any_reject: false,
    any_review: false,
    ...over,
  };
}

function decisionInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    guards: { passed: true, codes: [] },
    solver: { feasible: true, verdict: 'PASS', blocking: [] },
    eligibility: cleanEligibility(),
    policy: { auto_approve_warnings: false, confidence_min: 0 },
    confidence: 1,
    rateLimited: false,
    launderingCycle: false,
    ...over,
  };
}

// Every operator-tunable policy combination we sweep against.
const POLICY_COMBOS = [
  { auto_approve_warnings: false, confidence_min: 0 },
  { auto_approve_warnings: false, confidence_min: 1 },
  { auto_approve_warnings: true, confidence_min: 0 },
  { auto_approve_warnings: true, confidence_min: 1 },
];

// Compliance failure shapes: violated / unavailable on either or both parties,
// plus the zero-party fold.
const FAILING_FOLDS = [
  buildSolverResult(partyResult({ status: 'violated', violations: ['48h weekly cap'] }), partyResult()),
  buildSolverResult(partyResult(), partyResult({ status: 'violated', violations: ['11h rest'] })),
  buildSolverResult(partyResult({ status: 'violated' }), partyResult({ status: 'violated' })),
  buildSolverResult(partyResult({ status: 'unavailable' }), partyResult()),
  buildSolverResult(partyResult(), partyResult({ status: 'unavailable' })),
  buildSolverResult(partyResult({ status: 'unavailable' }), null),
  buildSolverResult(null, partyResult({ status: 'violated' })),
  buildSolverResult(null, null), // zero evaluated parties
];

describe('INVARIANT: a compliance failure can never be auto-approved', () => {
  it('BLOCKING/unavailable/zero-party × every policy combo ⇒ never AUTO_APPROVE', () => {
    for (const fold of FAILING_FOLDS) {
      expect(fold.verdict).toBe('BLOCKING');
      expect(fold.feasible).toBe(false);
      for (const policy of POLICY_COMBOS) {
        const d = decide(decisionInput({ solver: toSolverSummary(fold), policy }));
        expect(d.decision).toBe('AUTO_REJECT');
        expect(d.decision).not.toBe('AUTO_APPROVE');
      }
    }
  });

  it('auto_approve_warnings=true does NOT extend to BLOCKING', () => {
    const fold = buildSolverResult(
      partyResult({ status: 'violated', violations: ['overlap'] }),
      partyResult({ status: 'warned', warnings: ['approaching 48h'] }),
    );
    const d = decide(decisionInput({
      solver: toSolverSummary(fold),
      policy: { auto_approve_warnings: true, confidence_min: 0 },
    }));
    expect(d.decision).toBe('AUTO_REJECT');
  });

  it('infeasible-but-not-BLOCKING (defensive) still cannot approve', () => {
    // decide() checks `verdict === BLOCKING || !feasible` — cover the second leg.
    const d = decide(decisionInput({
      solver: { feasible: false, verdict: 'PASS', blocking: [] },
    }));
    expect(d.decision).toBe('AUTO_REJECT');
  });

  it('WARNING without the explicit opt-in routes to review, never approve', () => {
    const fold = buildSolverResult(
      partyResult({ status: 'warned', warnings: ['approaching cap'] }),
      partyResult(),
    );
    const d = decide(decisionInput({
      solver: toSolverSummary(fold),
      policy: { auto_approve_warnings: false, confidence_min: 0 },
    }));
    expect(d.decision).toBe('MANUAL_REVIEW');
  });
});

describe('INVARIANT: always-on eligibility rules cannot be configured away', () => {
  const ATTACKS: Record<string, RulePolicy>[] = [
    {},
    { certification: { enabled: false }, fatigue: { enabled: false }, overlap: { enabled: false } },
    {
      certification: { mode: 'ROUTE_TO_REVIEW_IF_FAIL' },
      fatigue: { mode: 'ROUTE_TO_REVIEW_IF_FAIL' },
      overlap: { mode: 'ROUTE_TO_REVIEW_IF_FAIL' },
    },
    { certification: { enabled: false, mode: 'ROUTE_TO_REVIEW_IF_FAIL' } },
  ];

  it('certification / fatigue / overlap stay AUTO_REJECT_IF_FAIL under every override attempt', () => {
    for (const rules of ATTACKS) {
      for (const ruleId of ['certification', 'fatigue', 'overlap']) {
        expect(effectiveMode(ruleId, rules)).toBe('AUTO_REJECT_IF_FAIL');
      }
    }
  });

  it('a fatigue-blocking solver signal ⇒ reject vote even when the policy tries to disable it', () => {
    const r = evaluateEligibility(
      {
        requesterShift: {
          id: 'rs', role_id: 'r', department_id: 'd', sub_department_id: 's',
          required_certs: [], paid_minutes: 480, hourly_rate: 30,
          start_at: '2026-07-01T09:00:00Z', end_at: '2026-07-01T17:00:00Z', shift_date: '2026-07-01',
        },
        offeredShift: {
          id: 'os', role_id: 'r', department_id: 'd', sub_department_id: 's',
          required_certs: [], paid_minutes: 480, hourly_rate: 30,
          start_at: '2026-07-02T09:00:00Z', end_at: '2026-07-02T17:00:00Z', shift_date: '2026-07-02',
        },
        requester: { employee_id: 'A', is_active: true, held_certs: [], roster: [], available_for_received: true },
        offerer: { employee_id: 'B', is_active: true, held_certs: [], roster: [], available_for_received: true },
        solver: {
          fatigue_blocking: true, fatigue_hits: ['20-in-28 breach'],
          overtime_warning: false, overtime_hits: [], warning_count: 0,
        },
        coverageFloor: null,
        coverageBefore: null,
      },
      { fatigue: { enabled: false } }, // attempted bypass
    );
    expect(r.rejectVotes.some((v) => v.ruleId === 'fatigue')).toBe(true);
  });
});
