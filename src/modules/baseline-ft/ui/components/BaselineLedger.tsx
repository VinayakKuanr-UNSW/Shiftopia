/**
 * The reconciliation — what each full-time employee is owed, what already
 * exists, and what the proposal does about the difference.
 *
 * This used to BE the screen. It is now the expanded row of the pattern table:
 * the summary band still sits above it, and `EmployeeDetail` opens underneath
 * whichever person a manager is asking about. The arithmetic did not change,
 * only where it is read.
 *
 * THE VARIANCE COLUMN CARRIES THE PRODUCT'S PHILOSOPHY. A non-zero variance is
 * a CORRECT answer, not a failure: cl 35.1(c) makes a short full-time day
 * unlawful, so when the remainder is smaller than a pattern day the honest
 * result is to leave it unscheduled and say why. The copy has to make that
 * legible, because a column of non-zero numbers otherwise reads as the tool
 * having failed at arithmetic.
 *
 * A NEGATIVE variance is a different fact again — the employee is already
 * rostered beyond their cycle ceiling. Baseline surfaces it and offers no fix,
 * because deleting a shift is outside this feature's authority.
 */

import React from 'react';
import { Users, CalendarClock, Plane, CalendarPlus, Scale, TrendingUp } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/modules/core/ui/primitives/table';
import { FindingList } from './FindingList';
import type { BaselineProposal, EmployeeLedger } from '../../api/baselineFt.commands';

/* ────────────────────────────────────────────────────────────────────────────
   Formatting
   ──────────────────────────────────────────────────────────────────────────── */

/** Hours to one decimal. Never rounded to whole hours: 7.6 is the whole point. */
export function fmtHours(h: number): string {
    return `${(Math.round(h * 10) / 10).toFixed(1)}h`;
}

/** A duration in the words a person uses for it: "48m", "1h 24m". */
export function fmtHm(hours: number): string {
    const total = Math.round(Math.abs(hours) * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    const sign = hours < 0 ? '−' : '';
    if (h === 0) return `${sign}${m}m`;
    if (m === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${m}m`;
}

/** Below this, a variance is float noise from dividing minutes by 60. */
export const VARIANCE_EPSILON = 0.05;

export type LedgerStatus = 'satisfied' | 'variance' | 'over' | 'blocked';

export function statusOf(l: EmployeeLedger): LedgerStatus {
    if (l.findings.some(f => f.severity === 'BLOCKING')) return 'blocked';
    if (l.varianceHours < -VARIANCE_EPSILON) return 'over';
    if (l.varianceHours > VARIANCE_EPSILON) return 'variance';
    return 'satisfied';
}

export const STATUS_CHIP: Record<LedgerStatus, { label: string; className: string }> = {
    satisfied: {
        label: 'Fully scheduled',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    },
    variance: {
        label: 'Variance',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-500/30',
    },
    over: {
        label: 'Over cycle cap',
        className: 'bg-destructive/10 text-destructive border-destructive/30',
    },
    blocked: {
        label: 'Needs attention',
        className: 'bg-destructive/10 text-destructive border-destructive/30',
    },
};

/* ────────────────────────────────────────────────────────────────────────────
   Summary band
   ──────────────────────────────────────────────────────────────────────────── */

export const BaselineSummary: React.FC<{
    proposal: BaselineProposal;
    dirtyCount?: number;
}> = ({ proposal, dirtyCount = 0 }) => {
    const t = proposal.totals;

    return (
        <section
            aria-label="Schedule Overview Bento Grid"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 w-full"
        >
            {/* Bento Card 1: To Schedule (Primary) */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-1 rounded-2xl border border-blue-200/70 dark:border-blue-500/30 bg-gradient-to-br from-blue-50/60 via-white to-white dark:from-blue-950/20 dark:via-card/50 dark:to-card/40 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                        To Schedule
                    </span>
                    <CalendarPlus className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </div>
                <div className="mt-2.5">
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                            {fmtHours(t.proposedHours)}
                        </span>
                        {t.proposedShiftCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                                {t.proposedShiftCount}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {t.blockedEmployees > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300 px-2 py-0.2 text-[10px] font-bold">
                                ● {t.blockedEmployees} Blocked
                            </span>
                        )}
                        {dirtyCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 px-2 py-0.2 text-[10px] font-bold">
                                ● {dirtyCount} Unsaved
                            </span>
                        )}
                        {t.blockedEmployees === 0 && dirtyCount === 0 && (
                            <span className="text-[11px] text-muted-foreground">
                                Ready to publish
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Bento Card 2: Employees */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white/95 dark:bg-card/40 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                        Employees
                    </span>
                    <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="mt-2.5">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                        {t.employees}
                    </span>
                    <span className="text-[11px] text-muted-foreground block mt-1">
                        Full-time active
                    </span>
                </div>
            </div>

            {/* Bento Card 3: Contracted */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white/95 dark:bg-card/40 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                        Contracted
                    </span>
                    <Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="mt-2.5">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                        {fmtHours(t.requiredHours)}
                    </span>
                    <span className="text-[11px] text-muted-foreground block mt-1">
                        Required demand
                    </span>
                </div>
            </div>

            {/* Bento Card 4: Rostered */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white/95 dark:bg-card/40 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                        Rostered
                    </span>
                    <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="mt-2.5">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                        {fmtHours(t.existingHours)}
                    </span>
                    <span className="text-[11px] text-muted-foreground block mt-1">
                        Already assigned
                    </span>
                </div>
            </div>

            {/* Bento Card 5: Leave */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-border/60 bg-white/95 dark:bg-card/40 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                        Leave
                    </span>
                    <Plane className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="mt-2.5">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                        {fmtHours(t.leaveHours)}
                    </span>
                    <span className="text-[11px] text-muted-foreground block mt-1">
                        Approved absences
                    </span>
                </div>
            </div>
        </section>
    );
};

/* ────────────────────────────────────────────────────────────────────────────
   Expanded detail
   ──────────────────────────────────────────────────────────────────────────── */

export const EmployeeDetail: React.FC<{ ledger: EmployeeLedger }> = ({ ledger }) => {
    const status = statusOf(ledger);

    return (
        <div className="space-y-5 w-full">
            {/* ── 1. The Calculation Card ── */}
            {ledger.cycles.map(c => (
                <div
                    key={c.cycleIndex}
                    className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161c2b] p-5 shadow-xs space-y-4"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-white/5">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
                            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                The Calculation
                            </h4>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                            Cycle: {c.start} – {c.endInclusive}
                            {c.activeDays < c.cycleDays && ` (${c.activeDays} of ${c.cycleDays} days in scope)`}
                        </span>
                    </div>

                    {/* Clean single-layer stat bar without nested boxes */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-white/5">
                        <div className="pt-2 sm:pt-0 sm:px-3 first:pl-0">
                            <span className="text-xs font-medium text-muted-foreground block">
                                Owed
                            </span>
                            <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
                                {fmtHours(c.requiredHours)}
                            </span>
                        </div>

                        <div className="pt-2 sm:pt-0 sm:px-3">
                            <span className="text-xs font-medium text-muted-foreground block">
                                Rostered
                            </span>
                            <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
                                {fmtHours(c.existingHours)}
                            </span>
                        </div>

                        <div className="pt-2 sm:pt-0 sm:px-3">
                            <span className="text-xs font-medium text-muted-foreground block">
                                Leave
                            </span>
                            <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
                                {fmtHours(c.paidLeaveHours)}
                            </span>
                        </div>

                        <div className="pt-2 sm:pt-0 sm:px-3">
                            <span className="text-xs font-medium text-muted-foreground block">
                                Holidays
                            </span>
                            <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
                                {fmtHours(c.publicHolidayCreditHours)}
                            </span>
                        </div>

                        <div className="pt-2 sm:pt-0 sm:px-3 last:pr-0">
                            <span className="text-xs font-bold text-foreground block">
                                Still Owed
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xl font-extrabold text-foreground tabular-nums">
                                    {fmtHours(c.deficitHours)}
                                </span>
                                {c.deficitHours > 0 ? (
                                    <span className="inline-flex rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[10px] px-1.5 py-0.2">
                                        Deficit
                                    </span>
                                ) : (
                                    <span className="inline-flex rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] px-1.5 py-0.2">
                                        Balanced
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {ledger.hasUnresolvedElection && (
                        <p className={cn(text.caption, 'text-xs text-muted-foreground pt-2 border-t border-slate-100 dark:border-white/5')}>
                            These figures assume the employee took their religious/cultural or
                            gender-affirmation leave as paid annual leave.
                        </p>
                    )}
                </div>
            ))}

            {/* ── 2. Proposed Shifts Card ── */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161c2b] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Proposed Shifts ({ledger.proposed.length})
                        </h4>
                    </div>
                    {ledger.proposed.length > 0 && (
                        <span className="text-xs font-medium text-muted-foreground">
                            {fmtHours(ledger.proposed.reduce((sum, c) => sum + (c.netMinutes / 60), 0))} total
                        </span>
                    )}
                </div>

                {ledger.proposed.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                        {status === 'satisfied'
                            ? 'Nothing to add — this employee’s contracted hours are already met.'
                            : 'No shifts could be proposed. See the notes below.'}
                    </p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {ledger.proposed.map(c => (
                            <div
                                key={c.idempotencyKey}
                                className="rounded-xl bg-slate-50 dark:bg-[#1f283d] border border-slate-200/80 dark:border-white/5 p-3.5 flex flex-col justify-between hover:bg-slate-100/80 dark:hover:bg-[#25304a] transition-colors"
                            >
                                <span className="font-bold text-xs text-foreground block">
                                    {c.shiftDate}
                                </span>
                                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-200/60 dark:border-white/10">
                                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                        {c.startTime}–{c.endTime}
                                    </span>
                                    <span className="inline-flex rounded-md bg-slate-200/80 dark:bg-white/10 text-foreground font-bold text-[11px] px-2 py-0.5 tabular-nums">
                                        {fmtHours(c.netMinutes / 60)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── 3. Rejected Shifts (if any) ── */}
            {ledger.rejected.length > 0 && (
                <div className="rounded-2xl border border-amber-200/80 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/10 p-5 shadow-xs space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                            Not Proposed ({ledger.rejected.length})
                        </h4>
                    </div>
                    <ul className="space-y-2">
                        {ledger.rejected.map(({ candidate, reasons }) => (
                            <li
                                key={candidate.idempotencyKey}
                                className="rounded-xl border border-amber-200/80 dark:border-amber-500/30 bg-white dark:bg-[#161c2b] p-3.5"
                            >
                                <div className="flex items-baseline gap-2">
                                    <span className="font-bold text-xs text-foreground">{candidate.shiftDate}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {candidate.startTime}–{candidate.endTime}
                                    </span>
                                </div>
                                <FindingList
                                    findings={reasons}
                                    showCalculation
                                    className="mt-2"
                                />
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ── 4. Notes (if any) ── */}
            {ledger.findings.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161c2b] p-5 shadow-xs space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Notes & Diagnostics
                        </h4>
                    </div>
                    <FindingList findings={ledger.findings} showCalculation />
                </div>
            )}
        </div>
    );
};
