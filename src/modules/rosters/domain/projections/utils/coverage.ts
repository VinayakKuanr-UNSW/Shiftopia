/**
 * Coverage health utilities.
 *
 * Centralises the staffing-health logic used by GroupMode sub-groups,
 * EventsMode event cards, and any future mode that shows a staffing ratio.
 *
 * Thresholds:
 *   ≥ 100 %  →  Fully Staffed   (emerald)
 *   ≥  80 %  →  Nearly Staffed  (amber)
 *   ≥  50 %  →  Low Coverage    (orange)
 *    < 50 %  →  Critical        (red)
 *   total=0  →  No Shifts       (slate)
 */

export interface CoverageHealth {
  /** Ratio 0–∞ (can exceed 1.0 if overstaffed) */
  ratio:      number;
  /** Human-readable label */
  label:      string;
  /** Tailwind text colour class */
  colorClass: string;
  /** Tailwind background colour class */
  bgClass:    string;
  /** 0-100 percentage, clamped at 100 for progress bars */
  pct:        number;
}

/**
 * Derive a CoverageHealth summary from assigned vs total shift counts.
 *
 * @param assigned  Number of shifts with an assigned_employee_id.
 * @param total     Total number of shifts (assigned + open).
 */
export function coverageHealth(assigned: number, total: number): CoverageHealth {
  if (total === 0) {
    return {
      ratio:      1,
      label:      'No Shifts',
      colorClass: 'text-slate-500',
      bgClass:    'bg-slate-500/10',
      pct:        100,
    };
  }

  const ratio = assigned / total;
  const pct   = Math.min(100, Math.round(ratio * 100));

  if (ratio >= 1)   return { ratio, label: 'Fully Staffed',  colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', pct };
  if (ratio >= 0.8) return { ratio, label: 'Nearly Staffed', colorClass: 'text-amber-400',   bgClass: 'bg-amber-500/10',   pct };
  if (ratio >= 0.5) return { ratio, label: 'Low Coverage',   colorClass: 'text-orange-400',  bgClass: 'bg-orange-500/10',  pct };
  return                   { ratio, label: 'Critical',       colorClass: 'text-red-400',     bgClass: 'bg-red-500/10',     pct };
}

/**
 * Derive the badge variant for a CoverageHealth (maps to shadcn Badge variants).
 */
export function coverageVariant(
  health: CoverageHealth,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const { ratio } = health;
  if (ratio >= 1)   return 'default';
  if (ratio >= 0.8) return 'secondary';
  return 'destructive';
}
