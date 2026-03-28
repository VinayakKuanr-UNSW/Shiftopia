import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import type { AttendanceStatus } from '../../domain/shift.entity';

export interface AttendanceBadgeProps {
  attendanceStatus: AttendanceStatus;
  actualStart: string | null;
  scheduledStart: string; // ISO datetime: shift_date + 'T' + start_time
  actualEnd: string | null;
  scheduledEnd: string;   // ISO datetime: shift_date + 'T' + end_time
  lifecycleStatus?: 'InProgress' | 'Completed';
  className?: string;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const AttendanceBadge: React.FC<AttendanceBadgeProps> = ({
  attendanceStatus,
  actualStart,
  scheduledStart,
  actualEnd,
  scheduledEnd,
  lifecycleStatus,
  className,
}) => {
  // Derive primary badge
  let primaryLabel = '';
  let primaryCls = '';
  let pulse = false;

  const scheduledStartMs = new Date(scheduledStart).getTime();
  const scheduledEndMs   = new Date(scheduledEnd).getTime();

  if (attendanceStatus === 'unknown') {
    if (lifecycleStatus === 'InProgress') {
      primaryLabel = 'Awaiting';
      primaryCls   = 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30';
      pulse        = true;
    } else {
      // Not InProgress — don't show anything
      return null;
    }
  } else if (attendanceStatus === 'checked_in') {
    const actualStartMs = actualStart ? new Date(actualStart).getTime() : scheduledStartMs;
    if (actualStartMs < scheduledStartMs) {
      primaryLabel = 'Early In ✓';
      primaryCls   = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
    } else {
      primaryLabel = 'On Time ✓';
      primaryCls   = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
    }
  } else if (attendanceStatus === 'late') {
    primaryLabel = 'Late In';
    primaryCls   = 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30';
  } else if (attendanceStatus === 'no_show') {
    primaryLabel = 'No Show';
    primaryCls   = 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30';
  } else if (attendanceStatus === 'excused') {
    primaryLabel = 'Excused';
    primaryCls   = 'bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30';
  }

  if (!primaryLabel) return null;

  // Derive secondary badge for clock-out timing
  let secondaryLabel = '';
  let secondaryCls   = '';

  if (actualEnd) {
    const actualEndMs = new Date(actualEnd).getTime();
    if (actualEndMs < scheduledEndMs - FIVE_MINUTES_MS) {
      secondaryLabel = '+ Early Out';
      secondaryCls   = 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30';
    } else if (actualEndMs > scheduledEndMs + FIVE_MINUTES_MS) {
      secondaryLabel = '+ Late Out';
      secondaryCls   = 'bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30';
    }
  }

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          primaryCls,
          pulse && 'animate-pulse',
        )}
      >
        {primaryLabel}
      </span>
      {secondaryLabel && (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            secondaryCls,
          )}
        >
          {secondaryLabel}
        </span>
      )}
    </div>
  );
};

export default AttendanceBadge;
