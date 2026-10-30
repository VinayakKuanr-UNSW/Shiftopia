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

import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import type { PeriodGrossPay } from '../model/gross-pay.types';
import { formatCost } from '../../rosters/domain/projections/utils/cost';
import { EarningsLinesTable } from './EarningsLinesTable';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { getTimeRule, getLiveRuleBadges } from '../../rosters/domain/shift-ui';
import { getShiftFSMState, getShiftStateDisplay } from '../../rosters/domain/shift-fsm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';

interface GrossPayPeriodViewProps {
  periods: PeriodGrossPay[];
  /** Period bounds (YYYY-MM-DD, inclusive) for the header. */
  periodStart: string;
  periodEnd: string;
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
  isLoading = false,
  error,
  className,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>('shiftDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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

  const currentSort = { key: sortKey, direction: sortDir };
  const onSort = (key: string) => handleSort(key as SortKey);

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
        <p className="text-[13px] font-medium leading-snug">{DISCLAIMER}</p>
      </div>

      {/* ── Period header + roll-up totals ────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">
          Pay period{' '}
          <span className="font-mono text-[13px] text-slate-600 dark:text-slate-300">
            {periodStart} → {periodEnd}
          </span>
        </h2>
        <p className="text-[13px] text-slate-600 dark:text-slate-300">
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
        <PageState state="loading" className={surface.bodyCard} title="Loading gross pay" />
      ) : error ? (
        <PageState state="error" className={surface.bodyCard} title="Couldn’t load gross pay" description="Gross pay for this period could not be calculated. Try again, or pick another period." />
      ) : allShifts.length === 0 ? (
        <PageState state="empty" className={surface.bodyCard} title="No gross pay for this period" description="No worked or approved shifts fall in this date range." />
      ) : (
        /* ── Shift Table List ───────────────────────────────────────── */
        <div className={cn(
          "overflow-hidden flex flex-col",
          surface.bodyCard
        )}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-12">
                    {/* Chevron column */}
                  </TableHead>
                  <SortableTableHeader sortKey="shiftDate" currentSort={currentSort} onSort={onSort}>Date & Day</SortableTableHeader>
                  <SortableTableHeader sortKey="shiftId" currentSort={currentSort} onSort={onSort}>Shift ID</SortableTableHeader>
                  <SortableTableHeader sortKey="groupName" currentSort={currentSort} onSort={onSort}>Group / Subgroup</SortableTableHeader>
                  <SortableTableHeader sortKey="employeeName" currentSort={currentSort} onSort={onSort}>Assignment</SortableTableHeader>
                  <SortableTableHeader sortKey="roleName" currentSort={currentSort} onSort={onSort}>Role</SortableTableHeader>
                  <SortableTableHeader sortKey="employmentType" currentSort={currentSort} onSort={onSort}>Contract</SortableTableHeader>
                  <SortableTableHeader sortKey="state" currentSort={currentSort} onSort={onSort}>State</SortableTableHeader>
                  <SortableTableHeader sortKey="hoursSource" currentSort={currentSort} onSort={onSort}>Time Rules</SortableTableHeader>
                  <SortableTableHeader sortKey="lifecycleStatus" currentSort={currentSort} onSort={onSort}>Live Rules</SortableTableHeader>
                  <SortableTableHeader sortKey="timesheetStatus" currentSort={currentSort} onSort={onSort}>Timesheet Status</SortableTableHeader>
                  <SortableTableHeader sortKey="startTime" currentSort={currentSort} onSort={onSort}>Timings</SortableTableHeader>
                  <SortableTableHeader sortKey="paidHours" currentSort={currentSort} onSort={onSort}>Net Length</SortableTableHeader>
                  <SortableTableHeader sortKey="grossPay" currentSort={currentSort} onSort={onSort} className="text-right">Gross Pay</SortableTableHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedShifts.map((shift) => {
                  const isOpen = !!expanded[shift.shiftId];

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
                      <TableRow
                        onClick={() => toggle(shift.shiftId)}
                        className={cn(
                          'cursor-pointer',
                          isOpen && 'bg-muted/30'
                        )}
                      >
                        <TableCell className="text-center text-slate-400 dark:text-slate-500">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 inline" />
                          ) : (
                            <ChevronRight className="h-4 w-4 inline" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-semibold text-slate-900 dark:text-white">
                          {dateLabel}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-slate-500 dark:text-slate-400" title={shift.shiftId}>
                          {shiftIdLabel}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300 truncate max-w-[150px]" title={groupSubgroup}>
                          {groupSubgroup}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300 truncate max-w-[150px]" title={assignment}>
                          {assignment}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={role}>
                          {role}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={contract}>
                          {contract}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {stateDisplay && (
                            <span
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap"
                              style={{
                                backgroundColor: stateDisplay.color + '15',
                                color: stateDisplay.color,
                                borderColor: stateDisplay.color + '30',
                              }}
                            >
                              {stateDisplay.id} · {stateDisplay.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {timeRulesLabel && (
                            <span
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap"
                              style={{
                                backgroundColor: timeRulesColor + '15',
                                color: timeRulesColor,
                                borderColor: timeRulesColor + '30',
                              }}
                            >
                              {timeRulesLabel}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {arrivalBadge && (
                              <span
                                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap"
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
                                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap"
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
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {timesheetStatusLabel && (
                            <span className={cn(
                              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap",
                              timesheetStatusClass
                            )}>
                              {timesheetStatusLabel}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {timings}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-slate-600 dark:text-slate-300">
                          {netLength}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold text-slate-900 dark:text-white">
                          {grossPay}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <tr className="border-b border-border/60 bg-muted/20">
                          <td />
                          <td colSpan={13} className="px-4 py-4">
                            <div className="max-w-3xl">
                              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shift Calculations</h4>
                              <EarningsLinesTable period={{ lines: shift.lines, grossPay: shift.grossPay } as any} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};

