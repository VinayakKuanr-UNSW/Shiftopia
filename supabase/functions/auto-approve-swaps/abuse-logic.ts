// =============================================================================
// auto-approve-swaps — Abuse-Brake Logic (PURE)
//
// Pure counting for the §4 post-gates:
//   4.1 swap farming  — committed AUTO_APPROVE count per employee, rolling
//       window ⇒ at/over `max_auto_per_employee_per_week` the swap is
//       DOWNGRADED to MANUAL_REVIEW (never hard-rejected from the worker side).
//   4.2 mutual favoritism — committed swaps between the same unordered pair.
//
// The DB access + fail-closed error handling live in index.ts (checkAbuse);
// this module is loaded directly by the project vitest.
// =============================================================================

/** The party columns of a shift_swaps row joined off a committed decision. */
export interface DecisionPartyRow {
  requester_id: string | null;
  target_id: string | null;
}

/** Per-employee committed-auto-approval counts across the window's rows. */
export function countAutoApprovals(rows: DecisionPartyRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const id of [r.requester_id, r.target_id]) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * True when ANY party has already reached the cap (>=): the Nth+1 auto-approval
 * is what gets downgraded. A cap of 0 means "never auto-approve without review".
 */
export function exceedsWeeklyCap(
  counts: Map<string, number>,
  parties: string[],
  maxPerWeek: number,
): boolean {
  return parties.some((p) => (counts.get(p) ?? 0) >= maxPerWeek);
}

/** Committed swaps between the same unordered {a,b} pair. */
export function pairCount(rows: DecisionPartyRow[], a: string, b: string): number {
  const key = pairKey(a, b);
  let n = 0;
  for (const r of rows) {
    if (r.requester_id && r.target_id && pairKey(r.requester_id, r.target_id) === key) n++;
  }
  return n;
}

export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}
