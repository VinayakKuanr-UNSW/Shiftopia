/**
 * ShiftPayLedgerView — every shift in the period with its Scheduled, Actual
 * and Billable Pay (see model/pay-ledger.types.ts). The one place a shift's pay
 * is shown.
 *
 * A shift with nobody on it shows ASSIGN AN EMPLOYEE FIRST across the three
 * pay columns: pay depends on the assignee's contract, so there is nothing to
 * price until someone is assigned.
 *
 * Dark-first, light-mode safe: semantic tokens, or colour utilities paired
 * with a dark: counterpart.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { getShiftFSMState, getShiftStateDisplay } from '@/modules/rosters/domain/shift-fsm';
import { formatCost } from '@/modules/rosters/domain/projections/utils/cost';
import type { LedgerCell, LedgerColumn, ShiftPayLedgerRow } from '../model/pay-ledger.types';
import { summarizeShiftPayLedger } from '../domain/summarizeShiftPayLedger';
import { EarningsLinesTable } from './EarningsLinesTable';

export interface ShiftPayLedgerViewProps {
  rows: ShiftPayLedgerRow[];
  periodStart: string;
  periodEnd: string;
  isLoading?: boolean;
  error?: unknown;
}

const PAGE_SIZE = 100;

const COLUMN_LABEL: Record<LedgerColumn, string> = {
  scheduled: 'Scheduled Pay',
  actual: 'Actual Pay',
  billable: 'Billable Pay',
};

type Filter = 'all' | 'needs_action' | 'unassigned' | 'no_contract' | 'unverified' | 'cancelled';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All shifts' },
  { value: 'needs_action', label: 'Needs action' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'no_contract', label: 'No contract' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'cancelled', label: 'Cancelled' },
];

function isUnverified(row: ShiftPayLedgerRow): boolean {
  return row.billable?.kind === 'priced' && !row.billableFinal;
}

function hasMissingClock(row: ShiftPayLedgerRow): boolean {
  return row.actual?.kind === 'no_clock' || row.billable?.kind === 'no_clock';
}

function matches(row: ShiftPayLedgerRow, filter: Filter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'needs_action': return row.state === 'unassigned' || row.state === 'no_contract' || hasMissingClock(row);
    case 'unassigned': return row.state === 'unassigned';
    case 'no_contract': return row.state === 'no_contract';
    case 'unverified': return isUnverified(row);
    case 'cancelled': return row.state === 'cancelled';
  }
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'EEE d MMM');
}

function formatHours(hours: number): string {
  return `${Math.round(hours * 100) / 100}h`;
}

function contractLabel(row: ShiftPayLedgerRow): string {
  if (row.payBasis === 'salary') return 'Salaried';
  const t = (row.employmentType ?? '').toLowerCase();
  const base = t === 'full-time' ? 'FT'
    : t === 'part-time' ? 'PT'
    : t === 'flexible part-time' ? 'Flex PT'
    : t === 'casual' ? 'Casual'
    : '';
  return [base, row.isSecurityRole ? 'Security' : ''].filter(Boolean).join(' · ') || '—';
}

const TIMESHEET_LABEL: Record<string, { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20' },
  locked: { label: 'Locked', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20' },
  submitted: { label: 'Pending', className: 'bg-purple-50 text-purple-700 ring-purple-600/10 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/20' },
  draft: { label: 'TS Draft', className: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/20' },
  rejected: { label: 'Denied', className: 'bg-rose-50 text-rose-700 ring-rose-600/10 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20' },
  no_show: { label: 'No Show', className: 'bg-rose-50 text-rose-700 ring-rose-600/10 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20' },
};

const PILL = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap';

/** One pay figure, or the reason there isn't one yet. */
const CellView: React.FC<{ cell: LedgerCell; unverified?: boolean }> = ({ cell, unverified }) => {
  switch (cell.kind) {
    case 'priced':
      return (
        <span className="inline-flex flex-col items-end">
          <span className="font-semibold tabular-nums text-foreground">{formatCost(cell.amount)}</span>
          {unverified && (
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Unverified</span>
          )}
        </span>
      );
    case 'salaried':
      return <span className="text-muted-foreground">Salaried · {formatHours(cell.hours)}</span>;
    case 'not_worked_yet':
      return <span className="text-muted-foreground">Not worked yet</span>;
    case 'in_progress':
      return <span className="text-sky-700 dark:text-sky-400">In progress</span>;
    case 'no_clock':
      return <span className="font-medium text-amber-700 dark:text-amber-400">Missing clock</span>;
    case 'no_show':
      return <span className="font-medium text-rose-700 dark:text-rose-400">No show</span>;
  }
};

/** The full-width message a row without pay figures shows instead of them. */
const SPAN_MESSAGE: Record<Exclude<ShiftPayLedgerRow['state'], 'priced'>, { text: string; className: string }> = {
  unassigned: {
    text: 'ASSIGN AN EMPLOYEE FIRST',
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  },
  no_contract: {
    text: 'NO CONTRACT — the assignee has no contract to pay this shift on',
    className: 'bg-rose-50 text-rose-800 dark:bg-rose-400/10 dark:text-rose-300',
  },
  cancelled: {
    text: 'Cancelled — not paid',
    className: 'bg-muted/40 text-muted-foreground',
  },
};

const DetailPanel: React.FC<{ column: LedgerColumn; cell: LedgerCell }> = ({ column, cell }) => (
  <div className="min-w-0 rounded-xl border border-border/60 bg-background/60 p-3">
    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{COLUMN_LABEL[column]}</h4>
    {cell.kind === 'priced' ? (
      <EarningsLinesTable period={{ lines: cell.lines, grossPay: cell.amount }} totalLabel={COLUMN_LABEL[column]} />
    ) : cell.kind === 'salaried' ? (
      <p className="text-sm text-muted-foreground">
        Salaried — no per-shift pay; the salary is paid per period. {formatHours(cell.hours)} worked.
      </p>
    ) : (
      <p className="text-sm text-muted-foreground"><CellView cell={cell} /></p>
    )}
  </div>
);

const SummaryTile: React.FC<{ label: string; value: string; detail: string; tone?: string }> = ({ label, value, detail, tone }) => (
  <div className="min-w-0 rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={cn('mt-1 text-xl font-bold tabular-nums text-foreground', tone)}>{value}</p>
    <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
  </div>
);

function columnDetail(c: { priced: number; salaried: number; pending: number }): string {
  return [
    `${c.priced} priced`,
    c.salaried ? `${c.salaried} salaried` : '',
    c.pending ? `${c.pending} pending` : '',
  ].filter(Boolean).join(' · ');
}

export const ShiftPayLedgerView: React.FC<ShiftPayLedgerViewProps> = ({
  rows,
  periodStart,
  periodEnd,
  isLoading = false,
  error,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const summary = useMemo(() => summarizeShiftPayLedger(rows), [rows]);
  const sorted = useMemo(
    () => [...rows].sort((a, b) =>
      a.shiftDate.localeCompare(b.shiftDate)
      || (a.startTime ?? '').localeCompare(b.startTime ?? '')
      || a.shiftId.localeCompare(b.shiftId)),
    [rows],
  );
  const filtered = useMemo(() => sorted.filter((r) => matches(r, filter)), [sorted, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) {
    return <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">Loading shift pay…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-8 text-center text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
        Failed to load shift pay for this period.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-snug">
          GROSS figures — exclude PAYG tax and superannuation; not a payslip of record. Salaries are
          paid per period and appear in Pay run, not against shifts.
        </p>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Shifts <span className="font-mono text-sm text-muted-foreground">{periodStart} → {periodEnd}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {summary.shiftCount} shift{summary.shiftCount === 1 ? '' : 's'}
          {summary.unassigned > 0 && <> · <span className="font-semibold text-amber-700 dark:text-amber-400">{summary.unassigned} unassigned</span></>}
          {summary.noContract > 0 && <> · <span className="font-semibold text-rose-700 dark:text-rose-400">{summary.noContract} no contract</span></>}
          {summary.cancelled > 0 && <> · {summary.cancelled} cancelled</>}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Scheduled Pay" value={formatCost(summary.scheduled.total)} detail={columnDetail(summary.scheduled)} />
        <SummaryTile label="Actual Pay" value={formatCost(summary.actual.total)} detail={columnDetail(summary.actual)} />
        <SummaryTile label="Billable Pay" value={formatCost(summary.billable.total)} detail={columnDetail(summary.billable)} />
        <SummaryTile
          label="Payable (approved)"
          value={formatCost(summary.payable)}
          detail={summary.unverified > 0 ? `${formatCost(summary.unverified)} awaiting approval` : 'All billable pay approved'}
          tone="text-emerald-700 dark:text-emerald-400"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter shifts">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => { setFilter(value); setPage(0); }}
            aria-pressed={filter === value}
            className={cn(
              'h-9 rounded-lg border px-3 text-xs font-semibold transition-colors',
              filter === value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? 'No shifts in this period.' : 'No shifts match this filter.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/40">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 px-3 py-2" aria-label="Expand" />
                  <th className="px-3 py-2">Shift ID</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Group / Sub-group</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">{COLUMN_LABEL.scheduled}</th>
                  <th className="px-3 py-2 text-right">{COLUMN_LABEL.actual}</th>
                  <th className="px-3 py-2 text-right">{COLUMN_LABEL.billable}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const canExpand = row.state === 'priced';
                  const isOpen = canExpand && !!expanded[row.shiftId];
                  const fsm = getShiftStateDisplay(getShiftFSMState(row.fsm));
                  const ts = TIMESHEET_LABEL[(row.timesheetStatus ?? '').toLowerCase()];
                  const group = [row.groupName, row.subGroupName].filter(Boolean).join(' / ') || '—';
                  return (
                    <React.Fragment key={row.shiftId}>
                      <tr
                        onClick={canExpand ? () => toggle(row.shiftId) : undefined}
                        className={cn(
                          'border-b border-border/30 transition-colors',
                          canExpand && 'cursor-pointer hover:bg-muted/20',
                          isOpen && 'bg-muted/10',
                        )}
                      >
                        <td className="px-3 py-2.5 text-center text-muted-foreground">
                          {canExpand && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggle(row.shiftId); }}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? 'Hide pay breakdown' : 'Show pay breakdown'}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted/40"
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground" title={row.shiftId}>
                          {row.shiftId.slice(0, 8)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-foreground">{formatDate(row.shiftDate)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : '—'}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-muted-foreground" title={group}>{group}</td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 text-muted-foreground" title={row.roleName}>{row.roleName ?? '—'}</td>
                        <td className="max-w-[160px] px-3 py-2.5">
                          <span className="block truncate text-foreground" title={row.employeeName}>{row.employeeName ?? '—'}</span>
                          {row.state === 'priced' && (
                            <span className="block text-[11px] text-muted-foreground">{contractLabel(row)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={PILL}
                              style={{ backgroundColor: fsm.color + '15', color: fsm.color, borderColor: fsm.color + '30' }}
                            >
                              {fsm.id} · {fsm.label}
                            </span>
                            {ts && <span className={cn(PILL, ts.className)}>{ts.label}</span>}
                          </div>
                        </td>
                        {row.state === 'priced' ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right"><CellView cell={row.scheduled!} /></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right"><CellView cell={row.actual!} /></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <CellView cell={row.billable!} unverified={isUnverified(row)} />
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} className="px-3 py-2.5">
                            <span className={cn(
                              'block rounded-md px-3 py-1.5 text-center text-xs font-bold tracking-wide',
                              SPAN_MESSAGE[row.state].className,
                            )}>
                              {SPAN_MESSAGE[row.state].text}
                            </span>
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border/30 bg-muted/5">
                          <td />
                          <td colSpan={10} className="px-3 py-4">
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                              <DetailPanel column="scheduled" cell={row.scheduled!} />
                              <DetailPanel column="actual" cell={row.actual!} />
                              <DetailPanel column="billable" cell={row.billable!} />
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
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-2 text-xs text-muted-foreground">
              <span>
                {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  className="h-9 rounded-lg border border-border/60 px-3 font-semibold disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                  className="h-9 rounded-lg border border-border/60 px-3 font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShiftPayLedgerView;
