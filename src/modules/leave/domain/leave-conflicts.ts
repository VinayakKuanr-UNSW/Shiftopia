/**
 * Leave ↔ roster conflict helpers (pure — no I/O).
 *
 * When leave is approved, shifts already assigned inside the leave range stay
 * assigned; the manager must unassign/re-offer them from the roster or the
 * employee will later be falsely marked No-Show. These helpers build the
 * warning copy shown after approval.
 */

/**
 * Build a manager-facing warning for rostered shifts that overlap an approved
 * leave range. Returns `null` when there are no conflicts.
 *
 * Lists at most `maxDates` distinct shift dates (sorted), with a `+N more`
 * suffix when truncated.
 */
export function formatLeaveConflictWarning(
  conflicts: ReadonlyArray<{ shiftDate: string }>,
  maxDates = 3,
): string | null {
  if (conflicts.length === 0) return null;

  const uniqueDates = [...new Set(conflicts.map((c) => c.shiftDate))].sort();
  const shown = uniqueDates.slice(0, maxDates);
  const hidden = uniqueDates.length - shown.length;
  const dateList = shown.join(', ') + (hidden > 0 ? ` +${hidden} more` : '');

  const n = conflicts.length;
  const noun = n === 1 ? 'shift overlaps' : 'shifts overlap';
  return `Approved — ${n} rostered ${noun} this leave (${dateList}). Unassign or re-offer them from the roster.`;
}
