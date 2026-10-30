
/**
 * Calculates a Utilization Score (Fairness).
 * 100% means they are exactly at their contracted hours.
 * < 100% means under-utilized.
 * > 100% means over-utilized (OT risk).
 */
export function calculateUtilization(scheduled: number, contracted: number): number {
  if (contracted <= 0) return 0;
  return (scheduled / contracted) * 100;
}
