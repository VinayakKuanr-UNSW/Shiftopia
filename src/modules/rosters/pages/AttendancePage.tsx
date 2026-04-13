/**
 * AttendancePage
 *
 * Two tabs:
 *  - Today  → live Clock In / Clock Out actions for today's shifts
 *  - Logs   → D / 3D / W / M attendance history, calendar picker, filters, totals
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  format, addDays, subDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, parseISO, differenceInMinutes, isToday,
} from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import {
  Fingerprint, MapPin, Loader2, UserX, LogIn, LogOut,
  CheckCircle, Timer, ChevronLeft, ChevronRight,
  BarChart3, Filter, CalendarIcon,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { useClockIn, useClockOut, useMarkNoShow } from '@/modules/rosters/state/useClockInOut';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { Button } from '@/modules/core/ui/primitives/button';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
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

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'D' | '3D' | 'W' | 'M';
type Tab  = 'today' | 'logs';
type StatusFilter = 'all' | 'checked_in' | 'late' | 'no_show' | 'unknown';

// ── Live clock ────────────────────────────────────────────────────────────────

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMs(shift: Shift, type: 'start' | 'end'): number {
  if (type === 'start') {
    // Always prefer local string combination as it is the direct user input.
    // UTC fields (start_at) are secondary and may be stale after an edit.
    return new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
  }

  // Handle end time with overnight support
  const end = new Date(`${shift.shift_date}T${shift.end_time}`);
  if (shift.is_overnight) {
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

function formatTime12(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const p = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${p}`;
}

function getGroupVariant(shift: Shift): 'convention' | 'exhibition' | 'theatre' | 'default' {
  const gt = shift.group_type?.toLowerCase() ?? '';
  if (gt.includes('convention'))  return 'convention';
  if (gt.includes('exhibition'))  return 'exhibition';
  if (gt.includes('theatre'))     return 'theatre';
  return 'default';
}

function getDateRange(anchor: Date, mode: Mode): { start: string; end: string; label: string } {
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (mode) {
    case 'D':
      return { start: fmt(anchor), end: fmt(anchor), label: format(anchor, 'EEE, d MMM') };
    case '3D': {
      const end = addDays(anchor, 2);
      return { start: fmt(anchor), end: fmt(end), label: `${format(anchor, 'd MMM')} – ${format(end, 'd MMM')}` };
    }
    case 'W': {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      const e = endOfWeek(anchor, { weekStartsOn: 1 });
      return { start: fmt(s), end: fmt(e), label: `${format(s, 'd MMM')} – ${format(e, 'd MMM')}` };
    }
    case 'M': {
      const s = startOfMonth(anchor);
      const e = endOfMonth(anchor);
      return { start: fmt(s), end: fmt(e), label: format(anchor, 'MMMM yyyy') };
    }
  }
}

function navigateAnchor(anchor: Date, mode: Mode, dir: -1 | 1): Date {
  switch (mode) {
    case 'D':  return dir === 1 ? addDays(anchor, 1)  : subDays(anchor, 1);
    case '3D': return dir === 1 ? addDays(anchor, 3)  : subDays(anchor, 3);
    case 'W':  return dir === 1 ? addDays(anchor, 7)  : subDays(anchor, 7);
    case 'M':  return dir === 1 ? addDays(anchor, 31) : subDays(anchor, 31);
  }
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

// ── Standardized Metrics Component ────────────────────────────────────────────

const MetricRow = ({ label, time, color = 'emerald' }: { label: string; time?: string | null; color?: 'emerald' | 'amber' | 'red' | 'blue' | 'slate' }) => {
  if (!time) return null;
  const colors = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
    blue: 'text-blue-500',
    slate: 'text-slate-500',
  };
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn('text-[9px] font-mono font-black text-foreground/70 uppercase tracking-widest')}>
        {label}
      </span>
      <span className={cn('text-[10px] font-mono font-black tabular-nums', colors[color])}>
        {time}
      </span>
    </div>
  );
};

const AttendanceMetrics = ({ shift }: { shift: Shift }) => {
  const status = (shift.attendance_status ?? 'unknown') as AttendanceStatus;
  const isNoShow = status === 'no_show';
  const isLateIn = status === 'late';
  
  const actualStartMs = shift.actual_start ? new Date(shift.actual_start).getTime() : null;
  const scheduledStartMs = new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
  const actualEndMs = shift.actual_end ? new Date(shift.actual_end).getTime() : null;
  // Use end_at (UTC ISO) when available so overnight shifts are handled correctly.
  // Fall back to local string + overnight offset when end_at is absent.
  const scheduledEndMs = shift.end_at
    ? new Date(shift.end_at).getTime()
    : (() => {
        const end = new Date(`${shift.shift_date}T${shift.end_time}`);
        if (shift.is_overnight) end.setDate(end.getDate() + 1);
        return end.getTime();
      })();
  const FIVE_MINS = 5 * 60 * 1000;

  const isEarlyIn = actualStartMs && actualStartMs < scheduledStartMs;
  const isEarlyOut = actualEndMs && actualEndMs < scheduledEndMs - FIVE_MINS;
  const isLateOut = actualEndMs && actualEndMs > scheduledEndMs + FIVE_MINS;
  
  const workedMins = shift.actual_start && shift.actual_end
    ? Math.max(0, differenceInMinutes(new Date(shift.actual_end), new Date(shift.actual_start)))
    : null;

  const inLabel = isLateIn ? 'Late In' : isEarlyIn ? 'Early In' : 'Check In';
  const inColor = isLateIn ? 'amber' : 'emerald';
  const inTime = shift.actual_start ? format(new Date(shift.actual_start), 'h:mm a') : '—';

  const outLabel = isLateOut ? 'Late Out' : isEarlyOut ? 'Early Out' : 'Check Out';
  const outColor = isLateOut ? 'slate' : isEarlyOut ? 'amber' : 'blue';
  const outTime = shift.actual_end ? format(new Date(shift.actual_end), 'h:mm a') : '—';

  return (
    <>
      {isNoShow ? (
        <div className="col-span-2 flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-mono font-black text-red-500 uppercase tracking-widest">No-Show</span>
          <span className="text-[10px] font-mono font-black text-red-500/70">REPORTED</span>
        </div>
      ) : (
        <>
          <MetricRow label={inLabel} time={inTime} color={inColor as any} />
          <MetricRow label={outLabel} time={outTime} color={outColor as any} />
        </>
      )}
      <MetricRow 
        label="Worked" 
        time={workedMins !== null ? formatHM(workedMins) : '0m'} 
        color="blue" 
      />
    </>
  );
};

// ── Today card using SharedShiftCard ─────────────────────────────────────────

interface TodayCardProps {
  shift: Shift;
  now: Date;
  isManager: boolean;
  onNoShow: (shift: Shift) => void;
}

const TodayCard: React.FC<TodayCardProps> = ({ shift, now, isManager, onNoShow }) => {
  const clockIn  = useClockIn();
  const clockOut = useClockOut();

  const startMs    = toMs(shift, 'start');
  const endMs      = toMs(shift, 'end');
  const windowOpen = startMs - 60 * 60 * 1000;
  const nowMs      = now.getTime();

  const timing   = getShiftTiming(shift, now);
  const status   = (shift.attendance_status ?? 'unknown') as AttendanceStatus;
  const canClockIn  = status === 'unknown' && timing === 'in_window' && !shift.actual_end;
  const canClockOut = (status === 'checked_in' || status === 'late') && !shift.actual_end && timing !== 'before_window';
  const canNoShow   = isManager && status === 'unknown' && shift.lifecycle_status === 'InProgress';

  const minsUntilWindow = timing === 'before_window'
    ? Math.max(0, Math.floor((windowOpen - nowMs) / 60000)) : 0;
  const minsRemaining = timing !== 'completed'
    ? Math.max(0, Math.floor((endMs - nowMs) / 60000)) : 0;
  const minsElapsed = Math.max(0, Math.floor((nowMs - startMs) / 60000));

  // ── GPS pre-capture ────────────────────────────────────────────────────────
  // Capture once when the clock-in/out window opens, so the indicator is ready
  // before the user taps the button.  Re-used by clockIn.mutate if < 30 s old.
  const [gpsCapture, setGpsCapture]   = useState<GPSCapture | null>(null);
  const [gpsAnalysis, setGpsAnalysis] = useState<GPSAnalysis | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);

  useEffect(() => {
    if (!canClockIn && !canClockOut) return;
    if (gpsCapture) return; // already have a capture
    let cancelled = false;
    setGpsCapturing(true);
    captureGPS().then((capture) => {
      if (cancelled) return;
      setGpsCapture(capture);
      // venueLat/venueLon: populate organizations.venue_lat/lon in DB to enable distance check
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
        <button className="flex items-center gap-1 focus:outline-none" aria-label="GPS status">
          {gpsCapturing ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
          ) : (
            <MapPin className={`h-3 w-3 ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground/40'}`} />
          )}
          <span className={`text-[9px] font-mono font-bold uppercase ${gpsAnalysis ? confidenceColor(gpsAnalysis.confidence) : 'text-muted-foreground/40'}`}>
            {gpsCapturing ? 'locating…' : gpsAnalysis ? gpsAnalysis.confidence : 'no gps'}
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

  const topContent = (timing === 'before_window' || shift.lifecycle_status === 'InProgress') ? (
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
  ) : null;

  const footerActions = (canClockIn || canClockOut || canNoShow) ? (
    <div className="px-4 pb-4 pt-1 flex flex-col gap-1.5">
      <div className="flex gap-2">
        {canClockIn && (
          <Button size="sm"
            onClick={() => clockIn.mutate({ shiftId: shift.id, preCapture: gpsCapture })}
            disabled={clockIn.isPending || gpsCapturing || !gpsCapture}
            title={!gpsCapture && !gpsCapturing ? 'Waiting for GPS fix…' : undefined}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-500/20 disabled:opacity-50">
            {clockIn.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Clocking in…</>
              : gpsCapturing
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Locating…</>
              : <><LogIn className="h-3.5 w-3.5 mr-1.5" />Clock In</>}
          </Button>
        )}
        {canClockOut && (
          <Button size="sm"
            onClick={() => clockOut.mutate({ shiftId: shift.id })}
            disabled={clockOut.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-500/20">
            {clockOut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Clocking out…</>
              : <><LogOut className="h-3.5 w-3.5 mr-1.5" />Clock Out</>}
          </Button>
        )}
        {canNoShow && (
          <Button size="sm" variant="outline" onClick={() => onNoShow(shift)}
            className="border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-xl font-bold text-xs">
            <UserX className="h-3.5 w-3.5 mr-1.5" />No-Show
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between">
        {gpsIndicator}
        <p className="text-[9px] text-muted-foreground/50 font-mono">
          Clock-in window · GPS required
        </p>
      </div>
    </div>
  ) : null;

  return (
    <SharedShiftCard
      organization={shift.organizations?.name ?? ''}
      department={shift.departments?.name ?? ''}
      subGroup={shift.sub_group_name ?? undefined}
      role={shift.roles?.name ?? 'Unassigned Role'}
      shiftDate={format(parseISO(shift.shift_date), 'EEE d MMM')}
      startTime={formatTime12(shift.start_time)}
      endTime={formatTime12(shift.end_time)}
      netLength={shift.net_length_minutes ?? shift.scheduled_length_minutes ?? 0}
      paidBreak={shift.paid_break_minutes ?? 0}
      unpaidBreak={shift.unpaid_break_minutes ?? 0}
      groupVariant={getGroupVariant(shift)}
      topContent={topContent}
      statusIcons={(shift.actual_start || shift.actual_end || shift.lifecycle_status === 'Completed') ? <AttendanceMetrics shift={shift} /> : undefined}
      footerActions={footerActions}
      isExpired={false}
    />
  );
};

// ── Log card using SharedShiftCard ────────────────────────────────────────────

const LogCard: React.FC<{ shift: Shift }> = ({ shift }) => {
  const status = (shift.attendance_status ?? 'unknown') as AttendanceStatus;
  const isAutoClockOut = shift.attendance_note === 'auto_clocked_out';

  const topContent = isAutoClockOut ? (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
        <LogOut className="h-3 w-3" />DID NOT CLOCK OUT
      </span>
    </div>
  ) : null;

  const statusIcons = (shift.actual_start || shift.actual_end || status === 'no_show') ? (
    <AttendanceMetrics shift={shift} />
  ) : undefined;

  return (
    <SharedShiftCard
      organization={shift.organizations?.name ?? ''}
      department={shift.departments?.name ?? ''}
      subGroup={shift.sub_group_name ?? undefined}
      role={shift.roles?.name ?? 'Unassigned Role'}
      shiftDate={format(parseISO(shift.shift_date), 'EEE d MMM')}
      startTime={formatTime12(shift.start_time)}
      endTime={formatTime12(shift.end_time)}
      netLength={shift.net_length_minutes ?? shift.scheduled_length_minutes ?? 0}
      paidBreak={shift.paid_break_minutes ?? 0}
      unpaidBreak={shift.unpaid_break_minutes ?? 0}
      groupVariant={getGroupVariant(shift)}
      topContent={topContent}
      statusIcons={statusIcons}
      isExpired={false}
    />
  );
};

// ── Totals bar ─────────────────────────────────────────────────────────────────

const TotalsBar: React.FC<{ shifts: Shift[] }> = ({ shifts }) => {
  const totals = useMemo(() => {
    let hoursWorked = 0;
    let lateInCount  = 0;
    let earlyOutCount = 0;
    let noShowCount  = 0;

    for (const s of shifts) {
      const status = s.attendance_status ?? 'unknown';
      if (status === 'late')    lateInCount++;
      if (status === 'no_show') noShowCount++;

      if (s.actual_start && s.actual_end) {
        const worked = Math.max(0, differenceInMinutes(new Date(s.actual_end), new Date(s.actual_start)));
        hoursWorked += worked;

        // Early out: clocked out 5+ min before scheduled end
        const scheduledEnd = s.end_at
          ? new Date(s.end_at).getTime()
          : new Date(`${s.shift_date}T${s.end_time}`).getTime();
        if (new Date(s.actual_end).getTime() < scheduledEnd - 5 * 60 * 1000) {
          earlyOutCount++;
        }
      }
    }

    return {
      hoursWorked: (hoursWorked / 60).toFixed(1),
      lateInCount,
      earlyOutCount,
      noShowCount,
    };
  }, [shifts]);

  return (
    <div className="grid grid-cols-4 gap-3 p-4 rounded-2xl bg-muted/40 border border-border">
      <div className="text-center">
        <p className="text-xl font-black font-mono text-foreground tabular-nums">{totals.hoursWorked}h</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Worked</p>
      </div>
      <div className="text-center">
        <p className="text-xl font-black font-mono text-amber-500 tabular-nums">{totals.lateInCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Late In</p>
      </div>
      <div className="text-center">
        <p className="text-xl font-black font-mono text-orange-500 tabular-nums">{totals.earlyOutCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">Early Out</p>
      </div>
      <div className="text-center">
        <p className="text-xl font-black font-mono text-red-500 tabular-nums">{totals.noShowCount}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest font-bold">No Show</p>
      </div>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const AttendancePage: React.FC = () => {
  const now  = useLiveClock();
  const { user, isManagerOrAbove } = useAuth();
  const isManager = isManagerOrAbove();

  const [tab, setTab]           = useState<Tab>('today');
  const [mode, setMode]         = useState<Mode>('W');
  const [anchor, setAnchor]     = useState<Date>(() => new Date());
  const [calOpen, setCalOpen]   = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const todayStr     = format(now, 'yyyy-MM-dd');
  // Include yesterday so overnight shifts that cross midnight remain visible
  // until the employee clocks out (e.g. Wed 19:30–00:30 still shows on Thu).
  const yesterdayStr = format(subDays(now, 1), 'yyyy-MM-dd');

  // Today's data — fetch [yesterday, today] so overnight shifts from yesterday
  // are included; filter to relevant shifts in sortedToday below.
  const { data: todayRaw = [], isLoading: todayLoading } = useQuery({
    queryKey: shiftKeys.attendance(user?.id ?? '', yesterdayStr, todayStr),
    queryFn:  () => shiftsQueries.getEmployeeShiftsForAttendance(user!.id, yesterdayStr, todayStr),
    enabled:  !!user?.id && tab === 'today',
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Log range data — same attendance query for history
  const { start: rangeStart, end: rangeEnd, label: rangeLabel } = getDateRange(anchor, mode);

  const { data: logShifts = [], isLoading: logsLoading } = useQuery({
    queryKey: shiftKeys.attendance(user?.id ?? '', rangeStart, rangeEnd),
    queryFn:  () => shiftsQueries.getEmployeeShiftsForAttendance(user!.id, rangeStart, rangeEnd),
    enabled:  !!user?.id && tab === 'logs',
    staleTime: 2 * 60 * 1000,
  });

  const filteredLogs = useMemo(() => {
    const sorted = [...logShifts].sort((a, b) => {
      const d = a.shift_date.localeCompare(b.shift_date);
      return d !== 0 ? d : a.start_time.localeCompare(b.start_time);
    });
    if (statusFilter === 'all') return sorted;
    return sorted.filter(s => (s.attendance_status ?? 'unknown') === statusFilter);
  }, [logShifts, statusFilter]);

  const groupedLogs = useMemo(() => {
    const groups: { date: string; shifts: Shift[] }[] = [];
    let cur = '';
    for (const s of filteredLogs) {
      if (s.shift_date !== cur) { cur = s.shift_date; groups.push({ date: cur, shifts: [] }); }
      groups[groups.length - 1].shifts.push(s);
    }
    return groups;
  }, [filteredLogs]);

  const sortedToday = useMemo(() => {
    return todayRaw
      .filter(shift => {
        // Always show today's shifts
        if (shift.shift_date === todayStr) return true;
        // Show yesterday's overnight shifts only while employee is still clocked in
        // (shift_date = yesterday, is_overnight = true, clocked in but no clock-out yet)
        const status = (shift.attendance_status ?? 'unknown') as string;
        return (
          shift.shift_date === yesterdayStr &&
          shift.is_overnight === true &&
          (status === 'checked_in' || status === 'late') &&
          !shift.actual_end
        );
      })
      .sort((a, b) => toMs(a, 'start') - toMs(b, 'start'));
  }, [todayRaw, todayStr, yesterdayStr],
  );

  const [noShowShift, setNoShowShift]   = useState<Shift | null>(null);
  const [noShowReason, setNoShowReason] = useState('');
  const noShowMutation = useMarkNoShow();

  const confirmNoShow = () => {
    if (!noShowShift || !noShowReason.trim()) return;
    noShowMutation.mutate(
      { shiftId: noShowShift.id, reason: noShowReason.trim() },
      { onSuccess: () => { setNoShowShift(null); setNoShowReason(''); } },
    );
  };

  return (
    <div className="h-full flex flex-col px-6 py-6 gap-5 overflow-y-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Fingerprint className="h-5 w-5 text-emerald-500" />
            <h1 className="text-2xl font-black tracking-tight text-foreground">My Attendance</h1>
          </div>
          <p className="text-sm text-muted-foreground">{format(now, 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-black text-foreground tabular-nums leading-none">{format(now, 'HH:mm')}</p>
          <p className="text-xs font-mono text-muted-foreground tabular-nums">:{format(now, 'ss')}</p>
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex rounded-xl bg-muted/50 p-1 gap-1 shrink-0">
        {(['today', 'logs'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-bold transition-all',
              tab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}>
            {t === 'today' ? "Today's Shifts" : 'Logs'}
          </button>
        ))}
      </div>

      {/* ══════════════ TODAY TAB ══════════════ */}
      {tab === 'today' && (
        <div className="flex-1 min-h-0">
          {todayLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedToday.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <CheckCircle className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-base font-bold text-foreground">No shifts scheduled today</p>
              <p className="text-sm text-muted-foreground">Check My Roster for upcoming shifts</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {sortedToday.map(shift => (
                  <TodayCard key={shift.id} shift={shift} now={now} isManager={isManager} onNoShow={setNoShowShift} />
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-border pt-3">
                <MapPin className="h-3 w-3" />Clock-in window: 1 h before start · GPS required
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ LOGS TAB ══════════════ */}
      {tab === 'logs' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">

          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Mode pills */}
            <div className="flex rounded-lg bg-muted/50 p-0.5 gap-0.5">
              {(['D', '3D', 'W', 'M'] as Mode[]).map(m => (
                <button key={m} onClick={() => { setMode(m); setAnchor(new Date()); }}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-black transition-all',
                    mode === m ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}>
                  {m}
                </button>
              ))}
            </div>

            {/* Date nav */}
            <div className="flex items-center gap-1 flex-1 min-w-[160px]">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => setAnchor(a => navigateAnchor(a, mode, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-bold text-foreground text-center flex-1 font-mono">{rangeLabel}</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => setAnchor(a => navigateAnchor(a, mode, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Calendar picker */}
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                  <CalendarIcon className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <DayPicker
                  mode="single"
                  selected={anchor}
                  onSelect={d => { if (d) { setAnchor(d); setCalOpen(false); } }}
                  showOutsideDays
                />
              </PopoverContent>
            </Popover>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <Filter className="h-3 w-3 mr-1.5 text-muted-foreground shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="checked_in">Completed</SelectItem>
                <SelectItem value="late">Late In</SelectItem>
                <SelectItem value="no_show">No Show</SelectItem>
                <SelectItem value="unknown">No Record</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
              {/* Totals */}
              {logShifts.length > 0 && <TotalsBar shifts={logShifts} />}

              {groupedLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-base font-bold text-foreground">No attendance records</p>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter !== 'all' ? 'Try removing the filter' : 'No shifts found for this period'}
                  </p>
                </div>
              ) : (
                groupedLogs.map(({ date, shifts }) => {
                  const d = parseISO(date);
                  const isTodayDate = isToday(d);
                  return (
                    <div key={date}>
                      {/* Day header */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className={cn(
                          'text-xs font-black uppercase tracking-widest font-mono',
                          isTodayDate ? 'text-emerald-500' : 'text-muted-foreground',
                        )}>
                          {isTodayDate ? 'Today' : format(d, 'EEEE')}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{format(d, 'd MMMM yyyy')}</div>
                        <div className="flex-1 h-px bg-border" />
                        <div className="text-[10px] text-muted-foreground/60 font-mono">{shifts.length} shift{shifts.length > 1 ? 's' : ''}</div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
                        {shifts.map(s => <LogCard key={s.id} shift={s} />)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ── No-show dialog ── */}
      <ResponsiveDialog
        open={!!noShowShift}
        onOpenChange={open => { if (!open) { setNoShowShift(null); setNoShowReason(''); } }}
      >
        <ResponsiveDialog.Header>
          <ResponsiveDialog.Title>Mark as No-Show</ResponsiveDialog.Title>
          <ResponsiveDialog.Description>
            This will mark the employee as a no-show. The action is logged and cannot be undone without a manager override.
          </ResponsiveDialog.Description>
        </ResponsiveDialog.Header>
        <ResponsiveDialog.Body className="py-4 space-y-2">
          <Label htmlFor="noshow-reason">Reason</Label>
          <Textarea id="noshow-reason" placeholder="e.g. Did not report for duty, no contact made…"
            value={noShowReason} onChange={e => setNoShowReason(e.target.value)} />
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="outline" onClick={() => { setNoShowShift(null); setNoShowReason(''); }} disabled={noShowMutation.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmNoShow}
            disabled={noShowMutation.isPending || !noShowReason.trim()}>
            {noShowMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Marking…</>
              : 'Confirm No-Show'}
          </Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>
    </div>
  );
};

export default AttendancePage;
