/**
 * AttendanceMetricsBar
 *
 * Shared attendance scorecard footer rendered on My Attendance and Timesheets.
 * Matches the exact container dimensions, glassmorphism, height (h-14), border,
 * and typography of RosterMetricsFooter & OpenBidsMetricsFooter:
 * - Standalone rounded-2xl capsule container outside the parent card
 * - Theme-aware glassmorphism (bg-white/95 dark:bg-[#1c2333]/85 border border-slate-300 dark:border-white/5)
 * - 9 parameter scorecard: Worked count anchor + 8 canonical graded rate tiles
 * - The numbers come from computeAttendanceMetrics() so every surface agrees.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import type { AttendanceMetrics } from '@/modules/rosters/domain/attendance-metrics';
import { getMetricStatus } from '@/modules/users/hooks/usePerformanceMetrics';

const statusTextColor: Record<'good' | 'warn' | 'critical', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-rose-600 dark:text-rose-400',
};

interface RateTile {
  label: string;
  value: number;
  thresholdKey: string;
}

interface AttendanceMetricsBarProps {
  metrics: AttendanceMetrics;
  className?: string;
}

export const AttendanceMetricsBar: React.FC<AttendanceMetricsBarProps> = ({ metrics, className }) => {
  // Order matches the canonical scorecard list (9 parameters).
  const rates: RateTile[] = [
    { label: 'Early In', value: metrics.earlyClockInPct, thresholdKey: 'early_clock_in_rate' },
    { label: 'On-Time In', value: metrics.onTimeInPct, thresholdKey: 'on_time_in_rate' },
    { label: 'Late In', value: metrics.lateClockInPct, thresholdKey: 'late_clock_in_rate' },
    { label: 'Early Out', value: metrics.earlyClockOutPct, thresholdKey: 'early_clock_out_rate' },
    { label: 'On-Time Out', value: metrics.onTimeOutPct, thresholdKey: 'on_time_out_rate' },
    { label: 'Late Out', value: metrics.lateClockOutPct, thresholdKey: 'late_clock_out_rate' },
    { label: 'Missing Out', value: metrics.autoClockOutPct, thresholdKey: 'auto_clock_out_rate' },
    { label: 'No-Show', value: metrics.noShowPct, thresholdKey: 'no_show_rate' },
  ];

  return (
    <footer
      role="region"
      aria-label="Attendance statistics scorecard"
      className={cn('w-full shrink-0', className)}
    >
      {/* Cells are never narrower than their label; on a phone the bar scrolls instead. */}
      <div className={cn(surface.footerBar, 'overflow-x-auto scrollbar-none select-none')}>
        {/* Shifts Worked — neutral count, anchors the row */}
        <div className="flex-1 min-w-max h-10 rounded-xl bg-white/70 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] border border-slate-200/60 dark:border-white/5 px-1.5 sm:px-2 py-1 flex flex-col items-center justify-between transition-all duration-300 hover:scale-[1.02] shrink-0 text-center">
          <span className="text-[11px] sm:text-[13px] font-black font-mono text-slate-900 dark:text-foreground tabular-nums leading-none">
            {metrics.workedCount}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-muted-foreground uppercase tracking-wider font-bold leading-none whitespace-nowrap">
            Worked
          </span>
        </div>

        {/* 8 Graded Rate Tiles */}
        {rates.map((tile) => {
          const status = getMetricStatus(tile.thresholdKey, tile.value);
          return (
            <div
              key={tile.label}
              className="flex-1 min-w-max h-10 rounded-xl bg-white/70 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] border border-slate-200/60 dark:border-white/5 px-1.5 sm:px-2 py-1 flex flex-col items-center justify-between transition-all duration-300 hover:scale-[1.02] shrink-0 text-center"
            >
              <span className={cn('text-[11px] sm:text-[13px] font-black font-mono tabular-nums leading-none', statusTextColor[status])}>
                {tile.value.toFixed(1)}%
              </span>
              <span className="text-[11px] text-slate-500 dark:text-muted-foreground uppercase tracking-wider font-bold leading-none whitespace-nowrap">
                {tile.label}
              </span>
            </div>
          );
        })}
      </div>
    </footer>
  );
};

