/**
 * The Attendance card's break panel: punched unpaid breaks, the scheduled
 * windows, the paid rest pause, and the "end your break first" alert.
 * Display only; the break buttons stay with the card's other punch actions.
 */
import { AlertCircle, Coffee } from 'lucide-react';
import { formatClockTime } from '@/modules/core/lib/date.utils';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

interface AttendanceBreaksPanelProps {
  shift: Shift;
  /** A break is open while the employee is clocked in. */
  showActiveBreakAlert: boolean;
}

export function AttendanceBreaksPanel({ shift, showActiveBreakAlert }: AttendanceBreaksPanelProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2 text-left">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Coffee className="h-3.5 w-3.5 text-amber-500" />
          Unpaid Breaks
        </span>
        <span className="text-[11px] font-mono font-semibold text-foreground">
          {shift.actual_unpaid_break_minutes !== null && shift.actual_unpaid_break_minutes !== undefined
            ? `${shift.actual_unpaid_break_minutes}m taken`
            : 'None taken (—)'}
        </span>
      </div>

      {/* Scheduled breaks target */}
      {shift.unpaid_breaks && shift.unpaid_breaks.length > 0 && (
        <div className="text-[11px] font-mono text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[11px] uppercase tracking-wide opacity-70">Scheduled:</span>
          {shift.unpaid_breaks.map((b) => (
            <span key={b.sno} className="bg-background/60 px-1.5 py-0.5 rounded border border-border/40">
              #{b.sno} {b.start}–{b.end}{b.duration ? ` (${b.duration}m)` : ''}
            </span>
          ))}
        </div>
      )}

      {/* Paid rest pause notice (if configured) */}
      {Boolean(shift.paid_break_minutes) && (
        <div className="text-[11px] text-muted-foreground/80 font-mono">
          Paid rest pause: {shift.paid_break_minutes}m (included in shift duration, no punch needed)
        </div>
      )}

      {/* Actual punch history */}
      {shift.timesheet_breaks && shift.timesheet_breaks.length > 0 && (
        <div className="space-y-1 pt-1.5 border-t border-border/30">
          {shift.timesheet_breaks.map((b) => (
            <div
              key={b.id || b.break_seq}
              className="flex items-center justify-between text-[11px] font-mono px-2.5 py-1 rounded-lg bg-background/50 border border-border/30"
            >
              <span className="font-semibold text-foreground/90">Break #{b.break_seq}</span>
              <span className="text-muted-foreground">
                {formatClockTime(b.break_start, 'h:mm a')} –{' '}
                {b.break_end ? (
                  formatClockTime(b.break_end, 'h:mm a')
                ) : (
                  <span className="inline-flex items-center gap-1 font-bold text-amber-500 animate-pulse">
                    In Progress
                  </span>
                )}
              </span>
              <span className="font-semibold text-foreground">
                {b.duration_minutes !== null ? `${b.duration_minutes}m` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Active break blocking alert */}
      {showActiveBreakAlert && (
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-[11px] font-medium">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Active break in progress. End break before clocking out.</span>
        </div>
      )}
    </div>
  );
}
