/**
 * attendance-metrics.ts
 *
 * Single client-side source of truth for the attendance scorecard shown on
 *   • My Attendance      (src/modules/rosters/pages/AttendancePage.tsx)
 *   • Timesheets         (src/modules/timesheets/ui/TimesheetPage.tsx)
 *
 * The definitions mirror the DB pipeline that feeds Insights › Performance
 * (get_quarterly_performance_report → assignment_snapshots), so the same
 * employee/period yields the same numbers regardless of surface:
 *
 *   • Grace window           = ±7.5 min (ATTENDANCE_GRACE_MINUTES)
 *   • Shifts Worked          = shifts the employee actually attended (end_reason 'worked')
 *   • Early/On-Time/Late In   } denominator = worked shifts (with the relevant clock present)
 *   • Early/On-Time/Late Out  }
 *   • Auto-ClockOut %        = auto-clocked-out shifts / worked
 *   • No-Show %              = no-shows / held   (held = worked + no-show)
 *
 * A clock time is `early` when its variance from schedule is < -7.5m,
 * `on_time` within ±7.5m, and `late` when > +7.5m.
 */

/** Canonical on-time grace window, in minutes. Matches DB migration 20260628020000. */
export const ATTENDANCE_GRACE_MINUTES = 7.5;

/** Normalised per-shift input. Variances are (actual − scheduled) in minutes. */
export interface AttendanceInput {
  /** actual_start − scheduled_start, in minutes. null when there is no clock-in. */
  clockInVarianceMin: number | null;
  /** actual_end − scheduled_end, in minutes. null when there is no clock-out. */
  clockOutVarianceMin: number | null;
  /** Raw shift.attendance_status ('checked_in' | 'late' | 'no_show' | 'auto_clock_out' | …). */
  attendanceStatus: string | null;
  /** True once the shift's scheduled window has ended (terminal). */
  hasEnded: boolean;
}

/** Per-shift classification flags. `worked` is the denominator for the in/out buckets. */
export interface AttendanceFlags {
  worked: boolean;
  noShow: boolean;
  autoClockOut: boolean;
  earlyIn: boolean;
  onTimeIn: boolean;
  lateIn: boolean;
  earlyOut: boolean;
  onTimeOut: boolean;
  lateOut: boolean;
}

const ATTENDED_STATUSES = new Set(['checked_in', 'late', 'auto_clock_out']);

/** Classify a single shift. Booleans are mutually consistent with the DB snapshot flags. */
export function classifyAttendance(input: AttendanceInput): AttendanceFlags {
  const { clockInVarianceMin, clockOutVarianceMin, attendanceStatus, hasEnded } = input;
  const status = (attendanceStatus ?? '').toLowerCase();

  const noShow = status === 'no_show';
  const autoClockOut = status === 'auto_clock_out';

  // Worked = the shift has ended, it's not a no-show, and there's evidence of
  // attendance (a recognised attended status or an actual clock-in).
  const worked =
    hasEnded && !noShow && (ATTENDED_STATUSES.has(status) || clockInVarianceMin != null);

  const g = ATTENDANCE_GRACE_MINUTES;

  // In/out buckets only apply to worked shifts that have the relevant clock time.
  const hasIn = worked && clockInVarianceMin != null;
  const hasOut = worked && clockOutVarianceMin != null;

  return {
    worked,
    noShow,
    autoClockOut,
    earlyIn: hasIn && clockInVarianceMin! < -g,
    onTimeIn: hasIn && clockInVarianceMin! >= -g && clockInVarianceMin! <= g,
    lateIn: hasIn && clockInVarianceMin! > g,
    earlyOut: hasOut && clockOutVarianceMin! < -g,
    onTimeOut: hasOut && clockOutVarianceMin! >= -g && clockOutVarianceMin! <= g,
    lateOut: hasOut && clockOutVarianceMin! > g,
  };
}

/** Aggregate counts + the 9 scorecard metrics. Rates are 0–100 percentages. */
export interface AttendanceMetrics {
  // Counts
  workedCount: number;
  heldCount: number;
  noShowCount: number;
  autoClockOutCount: number;
  earlyInCount: number;
  onTimeInCount: number;
  lateInCount: number;
  earlyOutCount: number;
  onTimeOutCount: number;
  lateOutCount: number;

  // Percentages (0–100). In/out + auto-clock-out are worked-based; no-show is held-based.
  earlyClockInPct: number;
  onTimeInPct: number;
  lateClockInPct: number;
  earlyClockOutPct: number;
  onTimeOutPct: number;
  lateClockOutPct: number;
  autoClockOutPct: number;
  noShowPct: number;
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

/** Compute the aggregate scorecard from a set of per-shift inputs. */
export function computeAttendanceMetrics(inputs: AttendanceInput[]): AttendanceMetrics {
  let workedCount = 0;
  let noShowCount = 0;
  let autoClockOutCount = 0;
  let earlyInCount = 0;
  let onTimeInCount = 0;
  let lateInCount = 0;
  let earlyOutCount = 0;
  let onTimeOutCount = 0;
  let lateOutCount = 0;

  for (const input of inputs) {
    const f = classifyAttendance(input);
    if (f.noShow) noShowCount++;
    if (!f.worked) continue;
    workedCount++;
    if (f.autoClockOut) autoClockOutCount++;
    if (f.earlyIn) earlyInCount++;
    if (f.onTimeIn) onTimeInCount++;
    if (f.lateIn) lateInCount++;
    if (f.earlyOut) earlyOutCount++;
    if (f.onTimeOut) onTimeOutCount++;
    if (f.lateOut) lateOutCount++;
  }

  const heldCount = workedCount + noShowCount;

  return {
    workedCount,
    heldCount,
    noShowCount,
    autoClockOutCount,
    earlyInCount,
    onTimeInCount,
    lateInCount,
    earlyOutCount,
    onTimeOutCount,
    lateOutCount,

    earlyClockInPct: pct(earlyInCount, workedCount),
    onTimeInPct: pct(onTimeInCount, workedCount),
    lateClockInPct: pct(lateInCount, workedCount),
    earlyClockOutPct: pct(earlyOutCount, workedCount),
    onTimeOutPct: pct(onTimeOutCount, workedCount),
    lateClockOutPct: pct(lateOutCount, workedCount),
    autoClockOutPct: pct(autoClockOutCount, workedCount),
    noShowPct: pct(noShowCount, heldCount),
  };
}
