/**
 * Surface the reason a shift mutation was rejected instead of a generic
 * failure.
 *
 * The state-invariant triggers raise messages that already say exactly what is
 * wrong — e.g.
 *
 *   [v3] Shift 37c0602c-…: Published+unassigned requires bidding_status
 *        != not_on_bidding
 *
 * which tells a manager the shift has to go out to bidding before its assignee
 * can be removed. Replacing that with "Failed to unassign shifts" threw the
 * only useful part away.
 *
 * This keeps the sentence and drops the internal decoration: the `[v3]` tag and
 * the shift UUID mean nothing to the person reading the toast.
 *
 * Returns undefined when nothing useful survives, so the caller can fall back
 * to its own wording rather than render an empty toast body.
 */
export function describeShiftMutationError(error: unknown): string | undefined {
  const message =
    typeof error === 'string'
      ? error
      : (error as { message?: string } | null)?.message;

  if (!message) return undefined;

  const cleaned = message
    .replace(/^\[v\d+\]\s*/, '')
    .replace(/^Shift\s+[0-9a-f-]{36}:\s*/i, '')
    .trim();

  return cleaned || undefined;
}
