// =============================================================================
// auto-approve-swaps — Solver Fold (PURE)
//
// Normalizes evaluate-compliance responses and folds the per-party verdicts
// into the SolverResult shape the decision matrix + audit payload consume.
//
// FAIL-CLOSED CONTRACT (compliance is a hard blocker, never ignorable):
//   - any party 'violated'      ⇒ feasible=false, verdict BLOCKING
//   - any party 'unavailable'   ⇒ feasible=false, verdict BLOCKING (engine down
//     / transport failure / unparseable response — treated as a violation)
//   - ZERO evaluated parties    ⇒ feasible=false, verdict BLOCKING (nothing was
//     compliance-checked, so nothing may be approved)
//   - any party 'warned'        ⇒ verdict WARNING (approvable only via the
//     org's explicit auto_approve_warnings opt-in — matrix step 6)
//   - all parties 'passed'      ⇒ verdict PASS
//
// NO Deno / DB / browser imports — the project vitest loads it directly.
// =============================================================================

import type { SolverSignals, SolverSummary } from './types.ts';

export type ComplianceStatus = 'passed' | 'violated' | 'warned' | 'unavailable';

export interface ComplianceResult {
  status: ComplianceStatus;
  violations: string[];
  warnings: string[];
  // ...other fields (weeklyHours, qualificationViolations, …) are passed through
  // opaquely; the worker only needs status/violations/warnings.
}

/** Per-party post-swap compliance verdict, kept in the audited solver_result. */
export interface PartyResult {
  employee_id: string;
  received_shift_id: string;
  excluded_shift_id: string | null;
  status: ComplianceStatus;
  violations: string[];
  warnings: string[];
}

export interface SolverResultLite {
  feasible: boolean;
  verdict: 'PASS' | 'WARNING' | 'BLOCKING';
  partyA: PartyResult | null;
  partyB: PartyResult | null;
  violations: { employee_id: string; status: ComplianceStatus; messages: string[] }[];
  warnings: { employee_id: string; messages: string[] }[];
}

/** Anything not shaped like a known verdict is 'unavailable' (fail-closed). */
// deno-lint-ignore no-explicit-any
export function normalizeCompliance(raw: any): ComplianceResult {
  const status: ComplianceStatus = ['passed', 'violated', 'warned', 'unavailable'].includes(
    raw?.status,
  )
    ? raw.status
    : 'unavailable';
  return {
    status,
    violations: Array.isArray(raw?.violations) ? raw.violations : [],
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
  };
}

export function buildSolverResult(
  partyA: PartyResult | null,
  partyB: PartyResult | null,
): SolverResultLite {
  const parties = [partyA, partyB].filter(Boolean) as PartyResult[];

  // Zero evaluated parties ⇒ nothing was compliance-checked. This must never
  // read as PASS: mark BLOCKING so the matrix can only reject/review, never
  // approve. (processRow also skips this case before deciding.)
  if (parties.length === 0) {
    return {
      feasible: false,
      verdict: 'BLOCKING',
      partyA,
      partyB,
      violations: [{
        employee_id: 'n/a',
        status: 'unavailable',
        messages: ['no party was compliance-evaluated (fail-closed)'],
      }],
      warnings: [],
    };
  }

  const anyViolated = parties.some(
    (p) => p.status === 'violated' || p.status === 'unavailable',
  );
  const anyWarned = parties.some((p) => p.status === 'warned');

  const violations = parties
    .filter((p) => p.status === 'violated' || p.status === 'unavailable')
    .map((p) => ({
      employee_id: p.employee_id,
      status: p.status,
      messages: p.status === 'unavailable'
        ? ['compliance engine unavailable (fail-closed)']
        : p.violations,
    }));

  const warnings = parties
    .filter((p) => p.status === 'warned')
    .map((p) => ({ employee_id: p.employee_id, messages: p.warnings }));

  return {
    feasible: !anyViolated,
    verdict: anyViolated ? 'BLOCKING' : anyWarned ? 'WARNING' : 'PASS',
    partyA,
    partyB,
    violations,
    warnings,
  };
}

export function toSolverSummary(r: SolverResultLite): SolverSummary {
  return {
    feasible: r.feasible,
    verdict: r.verdict,
    blocking: r.violations.map((v) => ({
      employee_name: v.employee_id,
      summary: v.messages.join('; ') || v.status,
    })),
  };
}

export function toSolverSignals(r: SolverResultLite): SolverSignals {
  // evaluate-compliance does not split fatigue vs overtime by constraint id; it
  // returns coarse violations/warnings. Map: a per-party BLOCKING verdict feeds
  // the always-on fatigue gate as a blocking signal (belt-and-braces — overlap
  // is also re-checked in the eligibility engine), and any warning feeds the
  // overtime/warning signals + the confidence penalty.
  const fatigueBlocking = r.verdict === 'BLOCKING';
  const warningCount = r.warnings.reduce((n, w) => n + (w.messages.length || 1), 0);
  const overtimeWarning = warningCount > 0;
  return {
    fatigue_blocking: fatigueBlocking,
    fatigue_hits: fatigueBlocking
      ? r.violations.flatMap((v) => v.messages.length ? v.messages : [v.status])
      : [],
    overtime_warning: overtimeWarning,
    overtime_hits: r.warnings.flatMap((w) => w.messages),
    warning_count: warningCount,
  };
}
