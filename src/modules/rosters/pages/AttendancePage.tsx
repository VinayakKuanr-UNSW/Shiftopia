/**
 * AttendancePage
 *
 * Two tabs:
 *  - Today  → live Clock In / Clock Out actions for today's shifts
 *  - Logs   → D / 3D / W / M attendance history, calendar picker, filters, totals
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  format, parseISO, startOfMonth,
} from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useQuery } from '@tanstack/react-query';
import {
  Fingerprint, MapPin, Loader2, UserX, LogIn, LogOut,
  CheckCircle, Timer,
  BarChart3, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { useAuth } from '@/platform/auth/useAuth';
import { supabase } from '@/platform/supabase/client';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { useClockIn, useClockOut } from '@/modules/rosters/state/useClockInOut';
import { useSettings } from '@/modules/settings/hooks/useSettings';
import { TimesheetMobileCard } from '@/modules/timesheets/ui/components/TimesheetMobileCard';
import type { TimesheetRow } from '@/modules/timesheets/model/timesheet.types';
import {
  resolveBillableSide,
  calculateNetMinutes,
  applyMinEngagementFloor,
  isShiftFinished as isShiftFinishedForBillable,
} from '@/modules/timesheets/domain/billable-time';
import { getShiftDayType } from '@/modules/core/lib/holidays';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import type { Shift, AttendanceStatus } from '@/modules/rosters/domain/shift.entity';
import {
  captureGPS,
  analyzeGPS,
  formatDistance,
  confidenceColor,
  flagLabel,
  type GPSCapture,
  type GPSAnalysis,
} from '@/modules/rosters/utils/gps';

import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { EmployeeFunctionBar, type EmployeeViewRange } from '@/modules/core/ui/components/EmployeeFunctionBar';
import { sortRows, DEFAULT_ROW_SORT, type RowSort } from '@/modules/core/lib/row-sorting';
import { UnifiedModuleFunctionBar } from '@/modules/core/ui/components/UnifiedModuleFunctionBar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  UnifiedRosterNavigator, type ViewType, type DateRange,
  computeRange, navigateDate, formatRangeLabel,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import {
  TimesheetFilterPanel,
  type ActiveFilters,
  EMPTY_FILTERS,
  countActiveFilters,
  applyTimesheetFilters,
} from '@/modules/timesheets/ui/components/TimesheetFilterDrawer';
import { GroupBySelector } from '@/modules/core/ui/components/GroupBySelector';
import { GroupSectionHeader } from '@/modules/core/ui/components/GroupSectionHeader';
import { groupRows, isTodayBucketKey, type RowGroupBy } from '@/modules/core/lib/row-grouping';
import {
  extractAttendanceGroupFields,
  attendanceGroupLabelFor,
  ATTENDANCE_GROUP_BY_OPTIONS,
  ATTENDANCE_STATUS_LABELS,
} from '@/modules/rosters/domain/attendance-grouping';
import {
  computeAttendanceMetrics,
  type AttendanceInput,
} from '@/modules/rosters/domain/attendance-metrics';
import { AttendanceMetricsBar } from '@/modules/rosters/ui/components/AttendanceMetricsBar';
import { isSecurityRoleName } from '@/modules/compliance/security-role';

// ── Motion variants ────────────────────────────────────────────────────────────

const pageVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 } },
};

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'checked_in' | 'late' | 'no_show' | 'unknown';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMs(shift: Shift, type: 'start' | 'end'): number {
  if (type === 'start') {
    // Prefer the canonical absolute instant (start_at) when present; otherwise
    // parse the naive shift_date + start_time as an Australia/Sydney wall-clock
    // so the epoch is correct regardless of the viewer's browser timezone.
    return shift.start_at
      ? new Date(shift.start_at).getTime()
      : parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime();
  }

  // Handle end time with overnight support
  const end = shift.end_at
    ? new Date(shift.end_at)
    : parseZonedDateTime(shift.shift_date, shift.end_time, SYDNEY_TZ);
  // start_at/end_at already encode the overnight rollover; only the naive-parse
  // fallback needs the +1 day bump.
  if (!shift.end_at && shift.is_overnight) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
}

function formatHM(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0m';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Shift timing ──────────────────────────────────────────────────────────────

type ShiftTiming = 'before_window' | 'in_window' | 'window_closed' | 'completed';

function getShiftTiming(shift: Shift, now: Date): ShiftTiming {
  // Always derive start/end from shift_date + start_time/end_time (local strings)
  // so stale start_at/end_at UTC values after edits never affect window logic.
  const startMs    = toMs(shift, 'start');
  const endMs      = toMs(shift, 'end');
  const windowOpen = startMs - 60 * 60 * 1000;          // 1 h before start
  const windowClose = startMs + 12.5 * 60 * 60 * 1000; // 12.5 h after start
  const nowMs      = now.getTime();
  if (nowMs > endMs)        return 'completed';
  if (nowMs > windowClose)  return 'window_closed';
  if (nowMs >= windowOpen)  return 'in_window';
  return 'before_window';
}

// ── Shift → TimesheetRow mapping (shared by the card + page-level filter/group) ──

/**
 * Billable window resolution — same three-tier rule (manager edit → snapped
 * actual → missing) the Timesheets card uses, via the canonical resolver, so
 * this self-service view can't drift from the manager-facing one. Hoisted to
 * module scope so both AttendanceCard's per-shift render AND the page-level
 * filter/Group By pipeline use the exact same mapping.
 */
/**
 * The employment basis this shift is PAID on.
 *
 * `shifts.target_employment_type` — NOT NULL since 20260806120100 — is the
 * shift's own basis, and it is the only correct pricing input. The profile
 * scalar is a person-level summary that cannot describe someone holding more
 * than one contract, which is the normal case here: one prod employee holds a
 * Full-Time Security L7 contract alongside four Casual ones, so their profile
 * reads "Full-Time" while their Casual Team Leader shift must be paid at the
 * loaded casual rate. Pricing that shift off the profile charged the permanent
 * Level 4 rate ($30.26/h) instead of the casual one ($37.82/h) — the 25%
 * casual loading silently dropped, a ~20% underpay on the estimate.
 *
 * The cost engine already reads the shift's target (see
 * `cost/index.ts::resolveEmploymentType`); this is about the callers that
 * hand-build a row and never gave it the chance.
 *
 * The profile remains a last-resort fallback for synthetic/preview rows that
 * have no persisted shift behind them.
 */
function resolvePayEmploymentType(shift: Shift, profileFallback: string | null): string | null {
  return shift.target_employment_type ?? profileFallback;
}

function shiftToTimesheetRow(shift: Shift, profileEmploymentType: string | null): TimesheetRow {
  const employmentType = resolvePayEmploymentType(shift, profileEmploymentType);
  const finished = isShiftFinishedForBillable(
    shift.shift_date,
    shift.start_time,
    shift.end_time,
    shift.actual_end ?? null,
  );
  const resolvedStart = resolveBillableSide(shift.adjusted_start ?? null, shift.actual_start ?? null, finished);
  const resolvedEnd = resolveBillableSide(shift.adjusted_end ?? null, shift.actual_end ?? null, finished);
  const rawNetMins = calculateNetMinutes(resolvedStart, resolvedEnd, shift.unpaid_break_minutes || 0);
  const isSecurityRoleForFloor = isSecurityRoleName(shift.roles?.name);
  const floored = rawNetMins !== null
    ? applyMinEngagementFloor(rawNetMins, {
        isTraining: shift.is_training === true,
        ...getShiftDayType(shift.shift_date),
        employmentType,
        isSecurityRole: isSecurityRoleForFloor,
      })
    : null;
  return {
    id: shift.id,
    date: shift.shift_date,
    employeeId: shift.assigned_employee_id || '',
    employee: shift.assigned_profiles ? `${shift.assigned_profiles.first_name || ''} ${shift.assigned_profiles.last_name || ''}`.trim() : 'Unknown',
    organization: shift.organizations?.name || '',
    department: shift.departments?.name || '',
    subDepartment: shift.sub_departments?.name || '',
    group: shift.roster_subgroup?.roster_group?.name || shift.group_type || '',
    subGroup: shift.sub_group_name || '',
    role: shift.roles?.name || '',
    remunerationLevel: (shift.remuneration_levels?.level_name && !shift.remuneration_levels.level_name.toLowerCase().includes('team lead') && !shift.remuneration_levels.level_name.toLowerCase().includes('operational control')) ? shift.remuneration_levels.level_name : '',
    scheduledStart: shift.start_time,
    scheduledEnd: shift.end_time,
    clockIn: shift.actual_start || '',
    clockOut: shift.actual_end || '',
    adjustedStart: resolvedStart.hhmm ?? '',
    adjustedEnd: resolvedEnd.hhmm ?? '',
    adjustedStartSource: resolvedStart.source === 'missing' ? null : resolvedStart.source,
    adjustedEndSource: resolvedEnd.source === 'missing' ? null : resolvedEnd.source,
    isAdjustedManual: !!(shift.timesheet_start_time || shift.timesheet_end_time),
    rawActualStart: shift.actual_start,
    rawActualEnd: shift.actual_end,
    rawStartAt: typeof shift.start_at === 'string' ? shift.start_at : shift.start_at ? new Date(shift.start_at).toISOString() : null,
    rawEndAt: typeof shift.end_at === 'string' ? shift.end_at : shift.end_at ? new Date(shift.end_at).toISOString() : null,
    length: String(shift.scheduled_length_minutes || 0),
    paidBreak: String(shift.paid_break_minutes || 0),
    unpaidBreak: String(shift.unpaid_break_minutes || 0),
    netLength: String(shift.net_length_minutes || 0),
    netLengthMinutes: floored?.netMinutes ?? undefined,
    wasToppedUpToMinEngagement: floored?.wasToppedUp,
    requiredEngagementMinutes: floored?.requiredMins || null,
    employmentType,
    isTraining: shift.is_training === true,
    isSecurityRole: isSecurityRoleForFloor,
    approximatePay: '',
    differential: '0',
    liveStatus: shift.lifecycle_status || '',
    timesheetStatus: shift.timesheet_status || 'draft',
    attendanceStatus: shift.attendance_status,
    notes: shift.timesheet_notes,
    rejectedReason: shift.timesheet_rejected_reason,
    groupType: shift.group_type,
  };
}

// ── Unified Attendance Card (combines history + live clocking) ───────────────

interface AttendanceCardProps {
  shift: Shift;
  now: Date;
  useGroupColoring?: boolean;
}

const AttendanceCard: React.FC<AttendanceCardProps> = ({ shift, now, useGroupColoring }) => {
  const { user } = useAuth();
  const clockIn  = useClockIn();
  const clockOut = useClockOut();

  const startMs    = toMs(shift, 'start');
  const endMs      = toMs(shift, 'end');
  const windowOpen = startMs - 60 * 60 * 1000;
  const nowMs      = now.getTime();

  const timing   = getShiftTiming(shift, now);
  const status   = (shift.attendance_status ?? 'unknown') as AttendanceStatus;
  const isAutoClockOut = false;

  const canClockIn  = status === 'unknown' && timing === 'in_window' && !shift.actual_end;
  const canClockOut = (status === 'checked_in' || status === 'late') && !shift.actual_end && timing !== 'before_window';

  const minsUntilWindow = timing === 'before_window'
    ? Math.max(0, Math.floor((windowOpen - nowMs) / 60000)) : 0;
  const minsRemaining = timing !== 'completed'
    ? Math.max(0, Math.floor((endMs - nowMs) / 60000)) : 0;
  const minsElapsed = Math.max(0, Math.floor((nowMs - startMs) / 60000));

  // ── GPS pre-capture ────────────────────────────────────────────────────────
  const [gpsCapture, setGpsCapture]   = useState<GPSCapture | null>(null);
  const [gpsAnalysis, setGpsAnalysis] = useState<GPSAnalysis | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  useEffect(() => {
    if (!canClockIn && !canClockOut) return;
    if (gpsCapture) return;
    let cancelled = false;
    setGpsCapturing(true);
    captureGPS().then((capture) => {
      if (cancelled) return;
      setGpsCapture(capture);
      setGpsAnalysis(analyzeGPS(capture, null, null));
      setGpsCapturing(false);
    });
    return () => { cancelled = true; };
  }, [canClockIn, canClockOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress bar for InProgress shifts
  const progress = shift.lifecycle_status === 'InProgress'
    ? Math.min(100, ((nowMs - startMs) / (endMs - startMs)) * 100) : 0;

  // ── GPS indicator (MapPin + popover) ──────────────────────────────────────
  const gpsIndicator = (canClockIn || canClockOut) ? (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-12 min-w-11 shrink-0 flex items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/30 px-3 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`GPS signal: ${gpsCapturing ? 'locating' : gpsAnalysis ? gpsAnalysis.confidence : 'no signal'}. Open details.`}
        >
          {gpsCapturing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <MapPin className={`h-4 w-4 ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground'}`} aria-hidden="true" />
          )}
          <span
            className={`text-[11px] font-bold uppercase tracking-[0.12em] ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground'}`}
            aria-hidden="true"
          >
            {gpsCapturing ? 'Locating' : gpsAnalysis ? gpsAnalysis.confidence : 'No GPS'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2 text-xs" align="start">
        <p className="font-bold text-foreground text-[11px] uppercase tracking-wide">GPS Signal</p>
        {gpsAnalysis?.hasLocation ? (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
              <span className="text-muted-foreground">Lat</span>
              <span className="text-foreground">{gpsCapture!.lat.toFixed(5)}</span>
              <span className="text-muted-foreground">Lon</span>
              <span className="text-foreground">{gpsCapture!.lon.toFixed(5)}</span>
              <span className="text-muted-foreground">Accuracy</span>
              <span className="text-foreground">{Math.round(gpsCapture!.accuracy)} m</span>
              {gpsAnalysis.distanceFromSite !== null && (
                <>
                  <span className="text-muted-foreground">Distance</span>
                  <span className="text-foreground">{formatDistance(gpsAnalysis.distanceFromSite)}</span>
                </>
              )}
            </div>
            {gpsAnalysis.flags.length > 0 && (
              <div className="pt-1 border-t border-border/40 space-y-0.5">
                {gpsAnalysis.flags.map(f => (
                  <p key={f} className="text-amber-500 text-[9px] font-semibold uppercase tracking-wide">
                    ⚠ {flagLabel(f)}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-red-500 text-[10px] font-semibold">GPS unavailable — clock-in is blocked until a fix is obtained.</p>
        )}
      </PopoverContent>
    </Popover>
  ) : null;

  let topContent: React.ReactNode = null;
  if (isAutoClockOut) {
    topContent = (
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
          <LogOut className="h-3 w-3" />DID NOT CLOCK OUT
        </span>
      </div>
    );
  } else if (timing === 'before_window' || shift.lifecycle_status === 'InProgress') {
    topContent = (
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {timing === 'before_window' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-500 dark:text-slate-400 border border-slate-500/30">
            <Timer className="h-3 w-3" />Opens in {formatHM(minsUntilWindow)}
          </span>
        )}
        {shift.lifecycle_status === 'InProgress' && shift.actual_start && !shift.actual_end && (
          <div className="w-full mt-1">
            <div className="flex items-center justify-between text-[9px] text-muted-foreground/60 mb-0.5 font-mono">
              <span>{formatHM(minsElapsed)} in</span>
              <span>{formatHM(minsRemaining)} left</span>
            </div>
            <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-1000" style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  /**
   * The clock action row.
   *
   * Full width, 48px tall. It used to be a `size="sm"` button hugging its own
   * label with the GPS state as a 9px caption beside it — the single most
   * important control on the page, and the smallest target on it. The GPS
   * readout is a real button (it opens a popover) so it now carries its own
   * 48px box rather than borrowing the row's.
   */
  const actionButtonCls =
    'flex-1 h-12 rounded-xl border-0 shadow-none bg-purple-600 hover:bg-purple-700 text-white ' +
    'dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white text-sm font-bold ' +
    'disabled:opacity-60 transition-colors';

  const footerActions = (canClockIn || canClockOut) ? (
    <div className="px-4 pb-4 pt-1 flex items-stretch gap-2 w-full">
      {canClockIn && (
        <Button
          onClick={() => clockIn.mutate({ shiftId: shift.id, preCapture: gpsCapture })}
          disabled={clockIn.isPending || gpsCapturing || !gpsCapture}
          title={!gpsCapture && !gpsCapturing ? 'Waiting for GPS fix…' : undefined}
          aria-label={gpsCapturing ? 'Waiting for GPS fix before clocking in' : 'Clock in'}
          className={actionButtonCls}>
          {clockIn.isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />Clocking In…</>
            : gpsCapturing
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />Locating…</>
            : <><LogIn className="h-4 w-4 mr-2" aria-hidden="true" />Clock In</>}
        </Button>
      )}
      {canClockOut && (
        <Button
          onClick={() => clockOut.mutate({ shiftId: shift.id })}
          disabled={clockOut.isPending}
          aria-label="Clock out"
          className={actionButtonCls}>
          {clockOut.isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />Clocking Out…</>
            : <><LogOut className="h-4 w-4 mr-2" aria-hidden="true" />Clock Out</>}
        </Button>
      )}
      {gpsIndicator}
    </div>
  ) : null;

  // Map to TimesheetRow structure for the shared card component — hoisted to
  // module scope (see shiftToTimesheetRow below) so the page-level filter/
  // Group By pipeline uses the exact same mapping instead of a second,
  // divergent copy (a prior version of this file hand-copied a similar-
  // looking but sentinel-blind mapper and silently priced everyone as Casual).
  const timesheetEntry: TimesheetRow = useMemo(
    () => shiftToTimesheetRow(shift, user?.employmentType ?? null),
    [shift, user?.employmentType],
  );

  return (
    <TimesheetMobileCard
      entry={timesheetEntry}
      isSelected={false}
      isSelectMode={false}
      onToggleSelect={() => {}}
      readOnly={false}
      isManager={false}
      employeeHeader={
        <div className="mb-2 space-y-2">
            {topContent}
        </div>
      }
      employeeActions={footerActions}
      hideGlow={true}
      useGroupColoring={useGroupColoring}
    />
  );
};

// ── Attendance scorecard input mapping ──────────────────────────────────────────

/**
 * Map a Shift to the normalised AttendanceInput consumed by the shared
 * computeAttendanceMetrics(). Scheduled bounds prefer the UTC-at-rest
 * start_at/end_at fields, falling back to the local shift_date + times
 * (overnight-aware via toMs), mirroring timesheets.supabase.api.ts.
 */
function shiftToAttendanceInput(shift: Shift, nowMs: number): AttendanceInput {
  const scheduledStartMs = shift.start_at ? new Date(shift.start_at).getTime() : toMs(shift, 'start');
  const scheduledEndMs   = shift.end_at   ? new Date(shift.end_at).getTime()   : toMs(shift, 'end');

  const effectiveInMs = shift.actual_start ? new Date(shift.actual_start).getTime() : null;
  const effectiveOutMs = shift.actual_end ? new Date(shift.actual_end).getTime() : null;

  const clockInVarianceMin = effectiveInMs !== null
    ? Math.round((effectiveInMs - scheduledStartMs) / 60000)
    : null;
  const clockOutVarianceMin = effectiveOutMs !== null
    ? Math.round((effectiveOutMs - scheduledEndMs) / 60000)
    : null;

  return {
    clockInVarianceMin,
    clockOutVarianceMin,
    attendanceStatus: shift.attendance_status ?? null,
    hasEnded: nowMs > scheduledEndMs || shift.lifecycle_status === 'Completed' || !!shift.actual_end,
  };
}

// ── Attendance status tabs (mirrors TIMESHEET_STATUS_TABS on /timesheet) ───────

const ATTENDANCE_STATUS_TABS: { id: StatusFilter; label: string; icon: React.FC<any>; accent: 'slate' | 'emerald' | 'amber' | 'red' }[] = [
  { id: 'all', label: ATTENDANCE_STATUS_LABELS.all, icon: BarChart3, accent: 'slate' },
  { id: 'checked_in', label: ATTENDANCE_STATUS_LABELS.checked_in, icon: CheckCircle, accent: 'emerald' },
  { id: 'late', label: ATTENDANCE_STATUS_LABELS.late, icon: Timer, accent: 'amber' },
  { id: 'no_show', label: ATTENDANCE_STATUS_LABELS.no_show, icon: UserX, accent: 'red' },
  { id: 'unknown', label: ATTENDANCE_STATUS_LABELS.unknown, icon: Fingerprint, accent: 'slate' },
];

const attendanceAccentMap: Record<string, { bg: string; text: string; ring: string }> = {
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/20' },
  red:     { bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-500/20' },
  slate:   { bg: 'bg-muted/50',       text: 'text-muted-foreground',                 ring: 'ring-border' },
};

const AttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewType, setViewType] = useState<ViewType>('week');
  const [range, setRange] = useState<DateRange>(() => computeRange(new Date(), 'week'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [groupBy, setGroupBy] = useState<RowGroupBy>('date');
  const [sort, setSort] = useState<RowSort>(DEFAULT_ROW_SORT);
  const [appliedFilters, setAppliedFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
  const { isDark } = useTheme();
  const { orgBranding } = useSettings();
  const useGroupColoring = (orgBranding as any)?.enable_group_coloring || false;

  const rangeStart = format(range.start, 'yyyy-MM-dd');
  const rangeEnd   = format(range.end,   'yyyy-MM-dd');

  // Consider current date for short polling interval if viewing current range
  const now = new Date();
  const isViewingToday = now >= parseISO(rangeStart) && now <= parseISO(rangeEnd);

  const { data: logShifts = [], isLoading: logsLoading, refetch } = useQuery({
    queryKey: shiftKeys.attendance(user?.id ?? '', rangeStart, rangeEnd),
    queryFn:  () => shiftsQueries.getEmployeeShiftsForAttendance(user!.id, rangeStart, rangeEnd),
    enabled:  !!user?.id,
    staleTime: isViewingToday ? 30 * 1000 : 2 * 60 * 1000,
    refetchInterval: isViewingToday ? 60 * 1000 : false,
  });

  // Listen to timesheet updates in real-time
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('timesheets_attendance')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'timesheets',
          filter: `employee_id=eq.${user.id}`,
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refetch]);

  // ── View type change handler (shared desktop & mobile) ──────────────────
  const handleViewTypeChange = useCallback((view: ViewType) => {
    let newDate = selectedDate;
    if (view === 'week') {
      newDate = startOfWeekAU(selectedDate);
    } else if (view === 'month') {
      newDate = startOfMonth(selectedDate);
    }
    setSelectedDate(newDate);
    setViewType(view);
    setRange(computeRange(newDate, view));
  }, [selectedDate]);

  // ── Mobile compact date nav helpers ─────────────────────────────────────
  const mobileRange = useMemo(() => computeRange(selectedDate, viewType), [selectedDate, viewType]);
  const mobileDateLabel = useMemo(() => formatRangeLabel(mobileRange, viewType), [mobileRange, viewType]);

  const handleMobilePrev = useCallback(() => {
    const newDate = navigateDate(selectedDate, viewType, -1);
    setSelectedDate(newDate);
    setRange(computeRange(newDate, viewType));
  }, [selectedDate, viewType]);

  const handleMobileNext = useCallback(() => {
    const newDate = navigateDate(selectedDate, viewType, 1);
    setSelectedDate(newDate);
    setRange(computeRange(newDate, viewType));
  }, [selectedDate, viewType]);

  // Scope-filtered shifts, most-recent-first — the shared basis for status
  // counts, the categorical filter drawer, and the final filtered/grouped log.
  const scopedLogs = useMemo(() => {
    let sorted = [...logShifts].sort((a, b) => {
      const d = b.shift_date.localeCompare(a.shift_date);
      return d !== 0 ? d : a.start_time.localeCompare(b.start_time);
    });

    if (scope) {
      if (scope.org_ids?.length > 0) {
        sorted = sorted.filter(s => s.organization_id && scope.org_ids.includes(s.organization_id));
      }
      if (scope.dept_ids?.length > 0) {
        sorted = sorted.filter(s => scope.dept_ids.includes(s.department_id));
      }
      if (scope.subdept_ids?.length > 0) {
        // Support department-level shifts (null subdept) if parent department is selected
        sorted = sorted.filter(s => {
          const subDeptMatch = s.sub_department_id && scope.subdept_ids.includes(s.sub_department_id);
          const isDeptLevel = !s.sub_department_id;
          return subDeptMatch || isDeptLevel;
        });
      }
    }
    return sorted;
  }, [logShifts, scope]);

  // TimesheetRow-shaped projection — feeds the shared categorical filter
  // drawer (Group/Sub-Group/Role) and Group By, via the same mapper
  // AttendanceCard renders from (see shiftToTimesheetRow above).
  const filterRows = useMemo(
    () => scopedLogs.map((s) => shiftToTimesheetRow(s, user?.employmentType ?? null)),
    [scopedLogs, user?.employmentType],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, checked_in: 0, late: 0, no_show: 0, unknown: 0 };
    for (const s of scopedLogs) {
      counts.all++;
      const st = s.attendance_status ?? 'unknown';
      counts[st] = (counts[st] ?? 0) + 1;
    }
    return counts;
  }, [scopedLogs]);

  const categoryFilteredIds = useMemo(() => {
    // No search query on this page — Attendance is always scoped to the
    // single logged-in employee, so a name/employee search has nothing to do.
    const rows = applyTimesheetFilters(filterRows, appliedFilters, '');
    return new Set(rows.map((r) => String(r.id)));
  }, [filterRows, appliedFilters]);

  const filteredLogs = useMemo(() => {
    let rows = scopedLogs.filter((s) => categoryFilteredIds.has(String(s.id)));
    if (statusFilter !== 'all') {
      rows = rows.filter((s) => (s.attendance_status ?? 'unknown') === statusFilter);
    }
    return rows;
  }, [scopedLogs, categoryFilteredIds, statusFilter]);

  // Sorted before grouping: `groupRows` preserves first-seen order, so the
  // bucket sequence follows the row order it is handed.
  const sortedLogs = useMemo(
    () => sortRows(filteredLogs, sort, (shift) => ({
      ...extractAttendanceGroupFields(shift),
      startTime: shift.start_time ?? undefined,
    })),
    [filteredLogs, sort],
  );

  const groupedBuckets = useMemo(
    () => groupRows(sortedLogs, groupBy, extractAttendanceGroupFields, attendanceGroupLabelFor),
    [sortedLogs, groupBy],
  );

  // Attendance scorecard — same 9 metrics/definitions as Timesheets + Insights.
  // Computed over the full fetched range (not the status filter) so the totals are stable.
  const attendanceMetrics = useMemo(
    () => computeAttendanceMetrics(logShifts.map((s) => shiftToAttendanceInput(s, Date.now()))),
    [logShifts],
  );


  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4"
    >
      {/* ── Unified Header ────────────────────────────────────────────── */}
      <GoldStandardHeader
        title="My Attendance"
        Icon={Fingerprint}
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        mode="personal"
        className="p-0"
        functionBar={
          <EmployeeFunctionBar
            view={viewType as EmployeeViewRange}
            onViewChange={(v) => handleViewTypeChange(v as ViewType)}
            selectedDate={selectedDate}
            onDateChange={(d) => { setSelectedDate(d); setRange(computeRange(d, viewType)); }}
            rangeLabel={mobileDateLabel}
            onPrevious={handleMobilePrev}
            onNext={handleMobileNext}
            sort={sort}
            onSortChange={setSort}
            sortOptions={['date', 'startTime', 'role', 'group', 'status']}
            activeFilterCount={activeFilterCount}
            filterContent={
              <TimesheetFilterPanel
                entries={filterRows}
                appliedFilters={appliedFilters}
                onApply={setAppliedFilters}
                statusFilter={statusFilter}
                onStatusFilterChange={(st) => setStatusFilter(st as StatusFilter)}
                statusCounts={statusCounts}
                statusOptions={ATTENDANCE_STATUS_TABS.map(t => ({ id: t.id, label: t.label }))}
                statusSectionLabel="Attendance Status"
              />
            }
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            groupByOptions={ATTENDANCE_GROUP_BY_OPTIONS}
          />
        }
      />

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn(
            "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
            isDark
                ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
                : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {logsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
                <span className="text-sm text-muted-foreground font-medium tracking-wide">
                  Loading attendance records…
                </span>
              </div>
            </div>
          ) : (
            <div className={cn(
              "flex-1 min-h-0 overflow-y-auto space-y-4 px-4 lg:px-6 py-4 pb-32 scrollbar-none",
              filteredLogs.length === 0 && "flex flex-col items-center justify-center pb-4"
            )}>
              {/* Attendance scorecard */}
              {logShifts.length > 0 && <AttendanceMetricsBar metrics={attendanceMetrics} />}

              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center gap-3">
                  <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-base font-bold text-foreground">No attendance records</p>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter !== 'all' || activeFilterCount > 0 ? 'Try removing a filter' : 'No shifts found for this period'}
                  </p>
                </div>
              ) : (
                groupedBuckets.map((bucket) => (
                  <div key={bucket.key}>
                    {bucket.label && (
                      <GroupSectionHeader
                        label={bucket.label}
                        count={bucket.items.length}
                        emphasized={isTodayBucketKey(bucket.key)}
                      />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5 mb-4">
                      {bucket.items.map(s => <AttendanceCard key={s.id} shift={s} now={now} useGroupColoring={useGroupColoring} />)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

    </motion.div>
  );
};

export default AttendancePage;
