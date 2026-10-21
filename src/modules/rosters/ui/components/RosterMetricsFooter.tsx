import React from 'react';
import { cn } from '@/modules/core/lib/utils';

export interface RosterMetricsFooterProps {
  totalShifts: number;
  assignedShifts: number;
  unfilledShifts: number;
  scheduledCost: number;
  actualCost: number;
  scheduledNetMinutes: number;
  actualNetMinutes: number;
  costedShifts: number;
  uncostedShifts: number;
  actualShifts: number;
  budget?: number;
  remainingBudget?: number;
  showBudget?: boolean;
  className?: string;
}

function formatNetMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/**
 * Disconnected metrics footer displaying Total Shifts, Assigned, Unfilled,
 * and Scheduled vs Actual cost comparisons.
 *
 * Follows the exact disconnected capsule pattern as RosterPaginationFooter:
 * - Standalone rounded-2xl capsule container outside the parent card
 * - Theme-aware glassmorphism (`bg-slate-100/85 dark:bg-[#1c2333]/85 border border-slate-200/50 dark:border-white/5`)
 * - Clean layout with WCAG AA contrast and tabular figures
 */
export const RosterMetricsFooter: React.FC<RosterMetricsFooterProps> = ({
  totalShifts,
  assignedShifts,
  unfilledShifts,
  scheduledCost,
  actualCost,
  scheduledNetMinutes,
  actualNetMinutes,
  costedShifts,
  uncostedShifts,
  actualShifts,
  budget = 0,
  remainingBudget = 0,
  showBudget = false,
  className,
}) => {
  return (
    <footer
      role="region"
      aria-label="Roster scheduled vs actual metrics"
      className={cn('w-full shrink-0', className)}
    >
      <div className="p-2 sm:px-4 sm:py-2.5 rounded-2xl bg-white/95 dark:bg-[#1c2333]/85 border border-slate-300 dark:border-white/5 shadow-sm backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
        {/* Left: Shifts count breakdown */}
        <div className="flex items-center gap-3 sm:gap-5 text-xs font-mono">
          <div className="flex items-center">
            <span className="text-slate-600 dark:text-muted-foreground/70 font-medium">Total Shifts:</span>
            <span className="ml-1.5 font-bold text-slate-900 dark:text-foreground tabular-nums">{totalShifts}</span>
          </div>
          <div className="w-[1px] h-3.5 bg-slate-300 dark:bg-border hidden sm:block" />
          <div className="flex items-center">
            <span className="text-slate-600 dark:text-muted-foreground/70 font-medium">Assigned:</span>
            <span className="ml-1.5 font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{assignedShifts}</span>
          </div>
          <div className="w-[1px] h-3.5 bg-slate-300 dark:bg-border hidden sm:block" />
          <div className="flex items-center">
            <span className="text-slate-600 dark:text-muted-foreground/70 font-medium">Unfilled:</span>
            <span className="ml-1.5 font-bold text-amber-700 dark:text-amber-400 tabular-nums">{unfilledShifts}</span>
          </div>
        </div>

        {/* Right: Scheduled vs Actual Cost Panels */}
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          {/* Scheduled Panel */}
          <div className="rounded-xl border border-blue-400/35 bg-blue-500/10 px-3 py-1.5 min-w-[130px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                Scheduled
              </span>
              <span className="text-[10px] font-mono text-slate-600 dark:text-muted-foreground tabular-nums">
                {formatNetMinutes(scheduledNetMinutes)}
              </span>
            </div>
            <div className="text-xs font-mono font-bold text-slate-900 dark:text-foreground tabular-nums leading-tight">
              ${scheduledCost.toFixed(2)}
            </div>
            <div
              className={cn(
                'text-[9px] font-mono leading-tight truncate max-w-[140px]',
                uncostedShifts > 0 ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-600 dark:text-muted-foreground/60'
              )}
              title={uncostedShifts > 0 ? 'Some shifts have no resolvable pay rate' : undefined}
            >
              {uncostedShifts > 0 ? `${costedShifts} of ${totalShifts} priced` : `${totalShifts} shift${totalShifts === 1 ? '' : 's'}`}
            </div>
          </div>

          {/* Actual Panel */}
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-1.5 min-w-[130px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Actual
              </span>
              <span className="text-[10px] font-mono text-slate-600 dark:text-muted-foreground tabular-nums">
                {formatNetMinutes(actualNetMinutes)}
              </span>
            </div>
            <div
              className={cn(
                'text-xs font-mono font-bold tabular-nums leading-tight',
                actualShifts === 0 ? 'text-slate-500 dark:text-muted-foreground/60' : 'text-slate-900 dark:text-foreground'
              )}
            >
              ${actualCost.toFixed(2)}
            </div>
            <div className="text-[9px] font-mono text-slate-600 dark:text-muted-foreground/60 leading-tight">
              {actualShifts === 0 ? 'none worked yet' : `${actualShifts} of ${totalShifts} worked`}
            </div>
          </div>

          {showBudget && (
            <>
              <div className="w-[1px] h-3.5 bg-slate-300 dark:bg-border hidden md:block" />
              <div className="text-xs font-mono">
                <span className="text-slate-600 dark:text-muted-foreground/70 font-medium">Budget:</span>
                <span className="ml-1.5 font-bold text-slate-900 dark:text-foreground tabular-nums">${budget.toFixed(2)}</span>
              </div>
              <div className="w-[1px] h-3.5 bg-slate-300 dark:bg-border hidden md:block" />
              <div className="text-xs font-mono">
                <span className="text-slate-600 dark:text-muted-foreground/70 font-medium">Remaining:</span>
                <span
                  className={cn(
                    'ml-1.5 font-bold tabular-nums',
                    remainingBudget >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-red-400'
                  )}
                >
                  ${remainingBudget.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </footer>
  );
};

export default RosterMetricsFooter;
