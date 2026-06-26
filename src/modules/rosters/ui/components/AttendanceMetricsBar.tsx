/**
 * AttendanceMetricsBar
 *
 * Shared attendance scorecard rendered on My Attendance and Timesheets.
 * Shows the same 9 metrics as Insights › Performance, all as percentages
 * (except Shifts Worked, a count), coloured by the shared METRIC_THRESHOLDS.
 *
 * The numbers come from computeAttendanceMetrics() so every surface agrees.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import type { AttendanceMetrics } from '@/modules/rosters/domain/attendance-metrics';
import { getMetricStatus } from '@/modules/users/hooks/usePerformanceMetrics';

const statusTextColor: Record<'good' | 'warn' | 'critical', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
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
  // Order matches the canonical scorecard list.
  const rates: RateTile[] = [
    { label: 'Early In', value: metrics.earlyClockInPct, thresholdKey: 'early_clock_in_rate' },
    { label: 'On-Time In', value: metrics.onTimeInPct, thresholdKey: 'on_time_in_rate' },
    { label: 'Late In', value: metrics.lateClockInPct, thresholdKey: 'late_clock_in_rate' },
    { label: 'Early Out', value: metrics.earlyClockOutPct, thresholdKey: 'early_clock_out_rate' },
    { label: 'On-Time Out', value: metrics.onTimeOutPct, thresholdKey: 'on_time_out_rate' },
    { label: 'Late Out', value: metrics.lateClockOutPct, thresholdKey: 'late_clock_out_rate' },
    { label: 'Auto Out', value: metrics.autoClockOutPct, thresholdKey: 'auto_clock_out_rate' },
    { label: 'No-Show', value: metrics.noShowPct, thresholdKey: 'no_show_rate' },
  ];

  return (
    <div
      className={cn(
        'grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3 p-4 rounded-2xl bg-muted/40 border border-border',
        className,
      )}
    >
      {/* Shifts Worked — neutral count, anchors the row */}
      <div className="text-center">
        <p className="text-xl font-black font-mono text-foreground tabular-nums">{metrics.workedCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Worked</p>
      </div>

      {rates.map((tile) => {
        const status = getMetricStatus(tile.thresholdKey, tile.value);
        return (
          <div key={tile.label} className="text-center">
            <p className={cn('text-xl font-black font-mono tabular-nums', statusTextColor[status])}>
              {tile.value.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">
              {tile.label}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default AttendanceMetricsBar;
