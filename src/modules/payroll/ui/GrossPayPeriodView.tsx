/**
 * GrossPayPeriodView — presentational summary of one pay period's gross pay,
 * one row per employee, each expandable into its itemised earnings breakdown
 * (reuses EarningsLinesTable).
 *
 * GROSS estimate only — a prominent banner makes clear this excludes PAYG tax
 * and superannuation and is NOT a payslip of record.
 *
 * Dark-first, light-mode safe: every colour utility is paired with a light
 * counterpart.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { format } from 'date-fns';
import type { PeriodGrossPay } from '../model/gross-pay.types';
import { formatCost } from '../../rosters/domain/projections/utils/cost';
import { EarningsLinesTable } from './EarningsLinesTable';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { getTimeRule, getLiveRuleBadges } from '../../rosters/domain/shift-ui';
import { getShiftFSMState, getShiftStateDisplay } from '../../rosters/domain/shift-fsm';

export interface GrossPayPeriodViewProps {
  periods: PeriodGrossPay[];
  /** Period bounds (YYYY-MM-DD, inclusive) for the header. */
  periodStart: string;
  periodEnd: string;
  /**
   * Optional employee-id → display-name map. When absent, the employeeId is
   * shown (this surface is presentational and does not fetch profiles).
   */
  employeeNames?: Record<string, string>;
  isLoading?: boolean;
  error?: unknown;
  className?: string;
}

type SortKey = 'shiftDate' | 'shiftId' | 'groupName' | 'employeeName' | 'roleName' | 'employmentType' | 'startTime' | 'paidHours' | 'grossPay' | 'hoursSource' | 'lifecycleStatus' | 'timesheetStatus' | 'state';
type SortDir = 'asc' | 'desc';

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}h`;
}

const DISCLAIMER =
  'GROSS estimate — excludes PAYG tax, superannuation & is not a payslip of record.';

export const GrossPayPeriodView: React.FC<GrossPayPeriodViewProps> = ({
  periods,
  periodStart,
  periodEnd,
  employeeNames,
  isLoading = false,
  error,
  className,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>('shiftDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { isDark } = useTheme();

  const toggle = (shiftId: string) =>
    setExpanded((prev) => ({ ...prev, [shiftId]: !prev[shiftId] }));

  const allShifts = useMemo(() => {
    return periods
      .flatMap((p) => p.shifts)
      .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.shiftId.localeCompare(b.shiftId));
  }, [periods]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedShifts = useMemo(() => {
    const copy = [...allShifts];
    copy.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];

      if (sortKey === 'state') {
        const stateA = a.rawShift ? getShiftFSMState(a.rawShift) : 'UNKNOWN';
        const stateB = b.rawShift ? getShiftFSMState(b.rawShift) : 'UNKNOWN';
        av = stateA;
        bv = stateB;
      } else if (sortKey === 'hoursSource') {
        const ruleA = a.rawShift ? getTimeRule(a.rawShift) : null;
        const ruleB = b.rawShift ? getTimeRule(b.rawShift) : null;
        av = ruleA?.label ?? 'None';
        bv = ruleB?.label ?? 'None';
      } else if (sortKey === 'lifecycleStatus') {
        const ruleA = a.rawShift ? getLiveRuleBadges(a.rawShift) : null;
        const ruleB = b.rawShift ? getLiveRuleBadges(b.rawShift) : null;
        const labelA = [ruleA?.arrival?.label, ruleA?.departure?.label].filter(Boolean).join(' ') || 'None';
        const labelB = [ruleB?.arrival?.label, ruleB?.departure?.label].filter(Boolean).join(' ') || 'None';
        av = labelA;
        bv = labelB;
      }

      if (av === undefined || av === null) return sortDir === 'asc' ? 1 : -1;
      if (bv === undefined || bv === null) return sortDir === 'asc' ? -1 : 1;

      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av) || 0;
      const bn = Number(bv) || 0;
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return copy;
  }, [allShifts, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30 shrink-0" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-primary shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-primary shrink-0" />
    );
  };

  const formatShiftDate = (dateStr: string): string => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return format(date, 'EEEE, yyyy-MM-dd');
    } catch (e) {
      return dateStr;
    }
  };

  const totals = useMemo(() => {
    return periods.reduce(
      (acc, p) => {
        acc.grossPay += p.grossPay;
        acc.paidHours += p.paidHours;
        acc.shiftCount += p.shiftCount;
        return acc;
      },
      { grossPay: 0, paidHours: 0, shiftCount: 0 },
    );
  }, [periods]);

  return (
    <div className={'flex flex-col gap-4 ' + (className ?? '')}>
      {/* ── Disclaimer banner ─────────────────────────────────────────── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-snug">{DISCLAIMER}</p>
      </div>

      {/* ── Period header + roll-up totals ────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Pay period{' '}
          <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
            {periodStart} → {periodEnd}
          </span>
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {periods.length} employee{periods.length === 1 ? '' : 's'} ·{' '}
          {formatHours(totals.paidHours)} paid ·{' '}
          <span className="font-semibold text-slate-900 dark:text-white">
            {formatCost(totals.grossPay)}
          </span>{' '}
          gross
        </p>
      </div>

      {/* ── States ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-400">
          Loading gross pay…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
          Failed to load gross pay for this period.
        </div>
      ) : allShifts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-400">
          No gross pay records for this period.
        </div>
      ) : (
        /* ── Shift Table List ───────────────────────────────────────── */
        <div className={cn(
          "rounded-[32px] border transition-all overflow-hidden flex flex-col",
          isDark 
              ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
              : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-12">
                    {/* Chevron column */}
                  </th>
                  <th
                    onClick={() => handleSort('shiftDate')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Date & Day
                      <SortIcon col="shiftDate" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('shiftId')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Shift ID
                      <SortIcon col="shiftId" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('groupName')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Group / Subgroup
                      <SortIcon col="groupName" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('employeeName')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Assignment
                      <SortIcon col="employeeName" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('roleName')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Role
                      <SortIcon col="roleName" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('employmentType')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Contract
                      <SortIcon col="employmentType" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('state')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      State
                      <SortIcon col="state" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('hoursSource')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Time Rules
                      <SortIcon col="hoursSource" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('lifecycleStatus')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Live Rules
                      <SortIcon col="lifecycleStatus" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('timesheetStatus')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Timesheet Status
                      <SortIcon col="timesheetStatus" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('startTime')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Timings
                      <SortIcon col="startTime" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('paidHours')}
                    className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20"
                  >
                    <div className="flex items-center gap-1">
                      Net Length
                      <SortIcon col="paidHours" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('grossPay')}
                    className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      Gross Pay
                      <SortIcon col="grossPay" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedShifts.map((shift, idx) => {
                  const isOpen = !!expanded[shift.shiftId];
                  const contentId = `gross-pay-detail-${shift.shiftId}`;

                  const dateLabel = formatShiftDate(shift.shiftDate);
                  const shiftIdLabel = shift.shiftId.slice(0, 8);
                  const groupSubgroup = [shift.groupName, shift.subGroupName].filter(Boolean).join(' / ') || '—';
                  const assignment = shift.employeeName || shift.employeeId;
                  const role = shift.roleName || '—';
                  let contract = '—';
                  if (shift.employmentType) {
                    // AUDIT FIX M3: mapEmploymentType returns 'Full-Time' etc.
                    // (Title-Case-with-hyphen), not 'full_time' (snake_case).
                    const l = shift.employmentType.toLowerCase();
                    if (l === 'full-time') contract = 'FT';
                    else if (l === 'flexible part-time') contract = 'Flex PT';
                    else if (l === 'part-time') contract = 'PT';
                    else if (l === 'casual') contract = 'Casual';
                    else contract = shift.employmentType;
                  }
                  // AUDIT FIX M4: Security shifts are priced under an entirely
                  // different regime (annualised / Sch 3) — a payroll reviewer
                  // needs to distinguish them visually.
                  if ((shift as any).isSecurityRole) contract += ' · Security';
                  const timings = (shift.startTime && shift.endTime) ? `${shift.startTime}–${shift.endTime}` : '—';
                  const netLength = shift.paidHours != null ? `${shift.paidHours.toFixed(1)}h` : '—';
                  const grossPay = formatCost(shift.grossPay);

                  // Resolve FSM State
                  let stateDisplay: { id: string; label: string; color: string } | null = null;
                  if (shift.rawShift) {
                    const fsmState = getShiftFSMState(shift.rawShift);
                    stateDisplay = getShiftStateDisplay(fsmState);
                  }

                  // Resolve status badges
                  // 1. Time Rules
                  let timeRulesLabel = 'None';
                  let timeRulesColor = '#64748B'; // slate

                  if (shift.rawShift) {
                    const rule = getTimeRule(shift.rawShift);
                    if (rule) {
                      timeRulesLabel = rule.label;
                      timeRulesColor = rule.color;
                    }
                  }

                  // 2. Live Rules (Roster Status)
                  let arrivalBadge: { label: string; color: string } | null = null;
                  let departureBadge: { label: string; color: string } | null = null;

                  if (shift.isLeave) {
                    arrivalBadge = { label: 'Leave', color: '#64748B' };
                  } else if (shift.rawShift) {
                    const badges = getLiveRuleBadges(shift.rawShift);
                    arrivalBadge = badges.arrival;
                    departureBadge = badges.departure;
                  }

                  // 3. Timesheet Status
                  let timesheetStatusLabel = 'None';
                  let timesheetStatusClass = 'bg-slate-50 text-slate-500 ring-slate-500/10 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-400/20';

                  if (shift.isLeave) {
                    timesheetStatusLabel = 'Approved';
                    timesheetStatusClass = 'bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20';
                  } else if (shift.timesheetStatus === 'no_show') {
                    timesheetStatusLabel = 'No Show';
                    timesheetStatusClass = 'bg-rose-50 text-rose-700 ring-rose-600/10 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20';
                  } else if (shift.timesheetStatus) {
                    const ts = shift.timesheetStatus.toLowerCase();
                    if (ts === 'auto_approved' || ts === 'auto_verified') {
                      timesheetStatusLabel = 'Auto-Approved';
                      timesheetStatusClass = 'bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20 font-bold';
                    } else if (ts === 'draft') {
                      timesheetStatusLabel = 'TS Draft';
                      timesheetStatusClass = 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/20';
                    } else if (ts === 'submitted' || ts === 'pending') {
                      timesheetStatusLabel = 'Pending';
                      timesheetStatusClass = 'bg-purple-50 text-purple-700 ring-purple-600/10 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/20';
                    } else if (ts === 'rejected' || ts === 'denied') {
                      timesheetStatusLabel = 'Denied';
                      timesheetStatusClass = 'bg-rose-50 text-rose-700 ring-rose-600/10 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20';
                    } else if (ts === 'approved' || ts === 'locked') {
                      timesheetStatusLabel = 'Approved';
                      timesheetStatusClass = 'bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20';
                    }
                  }

                  return (
                    <React.Fragment key={shift.shiftId}>
                      <tr
                        onClick={() => toggle(shift.shiftId)}
                        className={cn(
                          'group/row border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer text-xs md:text-sm',
                          idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/5',
                          isOpen ? 'bg-muted/10' : ''
                        )}
                      >
                        <td className="px-3 py-2.5 text-center text-slate-400 dark:text-slate-500">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 inline" />
                          ) : (
                            <ChevronRight className="h-4 w-4 inline" />
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-slate-900 dark:text-white border-r border-border/10">
                          {dateLabel}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-slate-500 dark:text-slate-400 border-r border-border/10" title={shift.shiftId}>
                          {shiftIdLabel}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 border-r border-border/10 truncate max-w-[150px]" title={groupSubgroup}>
                          {groupSubgroup}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 border-r border-border/10 truncate max-w-[150px]" title={assignment}>
                          {assignment}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 border-r border-border/10 truncate max-w-[120px]" title={role}>
                          {role}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 border-r border-border/10 truncate max-w-[120px]" title={contract}>
                          {contract}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap border-r border-border/10">
                          {stateDisplay && (
                            <span
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap"
                              style={{
                                backgroundColor: stateDisplay.color + '15',
                                color: stateDisplay.color,
                                borderColor: stateDisplay.color + '30',
                              }}
                            >
                              {stateDisplay.id} · {stateDisplay.label}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap border-r border-border/10">
                          {timeRulesLabel && (
                            <span
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap"
                              style={{
                                backgroundColor: timeRulesColor + '15',
                                color: timeRulesColor,
                                borderColor: timeRulesColor + '30',
                              }}
                            >
                              {timeRulesLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap border-r border-border/10">
                          <div className="flex items-center gap-1">
                            {arrivalBadge && (
                              <span
                                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap"
                                style={{
                                  backgroundColor: arrivalBadge.color + '15',
                                  color: arrivalBadge.color,
                                  borderColor: arrivalBadge.color + '30',
                                }}
                              >
                                {arrivalBadge.label}
                              </span>
                            )}
                            {departureBadge && (
                              <span
                                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap"
                                style={{
                                  backgroundColor: departureBadge.color + '15',
                                  color: departureBadge.color,
                                  borderColor: departureBadge.color + '30',
                                }}
                              >
                                {departureBadge.label}
                              </span>
                            )}
                            {!arrivalBadge && !departureBadge && (
                              <span className="text-slate-400 dark:text-slate-500">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap border-r border-border/10">
                          {timesheetStatusLabel && (
                            <span className={cn(
                              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap",
                              timesheetStatusClass
                            )}>
                              {timesheetStatusLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 border-r border-border/10">
                          {timings}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium text-slate-600 dark:text-slate-300 border-r border-border/10">
                          {netLength}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-right font-semibold text-slate-900 dark:text-white">
                          {grossPay}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/50 dark:bg-black/20">
                          <td />
                          <td colSpan={13} className="px-6 py-4 border-b border-border/30">
                            <div className="max-w-3xl">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Shift Calculations</h4>
                              <EarningsLinesTable period={{ lines: shift.lines, grossPay: shift.grossPay } as any} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default GrossPayPeriodView;
