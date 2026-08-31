/**
 * The review ledger — what each full-time employee is owed, what already
 * exists, and what the run proposes to do about the difference.
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
import { ChevronRight, Users, CalendarClock, Plane, CalendarPlus, Scale } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
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
const VARIANCE_EPSILON = 0.05;

type LedgerStatus = 'satisfied' | 'variance' | 'over' | 'blocked';

export function statusOf(l: EmployeeLedger): LedgerStatus {
    if (l.findings.some(f => f.severity === 'BLOCKING')) return 'blocked';
    if (l.varianceHours < -VARIANCE_EPSILON) return 'over';
    if (l.varianceHours > VARIANCE_EPSILON) return 'variance';
    return 'satisfied';
}

const STATUS_CHIP: Record<LedgerStatus, { label: string; className: string }> = {
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

const SummaryTile: React.FC<{
    Icon: typeof Users; label: string; value: string; hint?: string;
}> = ({ Icon, label, value, hint }) => (
    <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className={text.overline}>{label}</span>
        </div>
        <p className={cn(text.display, 'mt-1 tabular-nums')}>{value}</p>
        {hint && <p className={cn(text.subtle, 'mt-0.5')}>{hint}</p>}
    </div>
);

export const BaselineSummary: React.FC<{ proposal: BaselineProposal }> = ({ proposal }) => {
    const t = proposal.totals;
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryTile
                Icon={Users} label="Full-time" value={String(t.employees)}
                hint={t.employees === 1 ? 'employee' : 'employees'}
            />
            <SummaryTile
                Icon={Scale} label="Contracted" value={fmtHours(t.requiredHours)}
                hint="owed this period"
            />
            <SummaryTile
                Icon={CalendarClock} label="Already rostered" value={fmtHours(t.existingHours)}
                hint="all sub-departments"
            />
            <SummaryTile
                Icon={Plane} label="Leave credit" value={fmtHours(t.leaveHours)}
                hint="paid absence + holidays"
            />
            <SummaryTile
                Icon={CalendarPlus} label="To schedule" value={fmtHours(t.proposedHours)}
                hint={`${t.proposedShiftCount} shift${t.proposedShiftCount === 1 ? '' : 's'}`}
            />
        </div>
    );
};

/* ────────────────────────────────────────────────────────────────────────────
   Expanded detail
   ──────────────────────────────────────────────────────────────────────────── */

const EmployeeDetail: React.FC<{ ledger: EmployeeLedger }> = ({ ledger }) => {
    const status = statusOf(ledger);

    return (
        <div className="space-y-5 bg-muted/30 px-4 py-4">
            {/* ── How the number was reached, per anchored cycle ── */}
            <section>
                <h4 className={cn(text.overline, 'mb-2')}>The calculation</h4>
                <div className="overflow-x-auto rounded-md border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Work cycle</TableHead>
                                <TableHead className="text-right">Owed</TableHead>
                                <TableHead className="text-right">Rostered</TableHead>
                                <TableHead className="text-right">Leave</TableHead>
                                <TableHead className="text-right">Holidays</TableHead>
                                <TableHead className="text-right">Still owed</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {ledger.cycles.map(c => (
                                <TableRow key={c.cycleIndex}>
                                    <TableCell className={cn(text.body, 'whitespace-nowrap')}>
                                        {c.start} – {c.endInclusive}
                                        {c.activeDays < c.cycleDays && (
                                            <span className={cn(text.subtle, 'ml-1.5')}>
                                                ({c.activeDays} of {c.cycleDays} days in scope)
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(c.requiredHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(c.existingHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(c.paidLeaveHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(c.publicHolidayCreditHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(c.deficitHours)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                {ledger.hasUnresolvedElection && (
                    <p className={cn(text.caption, 'mt-2')}>
                        These figures assume the employee took their religious/cultural or
                        gender-affirmation leave as paid annual leave. Taken as unpaid leave they
                        would owe more.
                    </p>
                )}
            </section>

            {/* ── What will be created ── */}
            <section>
                <h4 className={cn(text.overline, 'mb-2')}>
                    Proposed shifts ({ledger.proposed.length})
                </h4>
                {ledger.proposed.length === 0 ? (
                    <p className={text.caption}>
                        {status === 'satisfied'
                            ? 'Nothing to add — this employee’s contracted hours are already met.'
                            : 'No shifts could be proposed. See the notes below.'}
                    </p>
                ) : (
                    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {ledger.proposed.map(c => (
                            <li
                                key={c.idempotencyKey}
                                className="flex items-baseline justify-between gap-2 rounded-md border bg-card px-3 py-2"
                            >
                                <span className={text.body}>{c.shiftDate}</span>
                                <span className={cn(text.metricMono, 'text-muted-foreground')}>
                                    {c.startTime}–{c.endTime}
                                </span>
                                <span className={text.metric}>{fmtHours(c.netMinutes / 60)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ── What was refused, and why ── */}
            {ledger.rejected.length > 0 && (
                <section>
                    <h4 className={cn(text.overline, 'mb-2')}>
                        Not proposed ({ledger.rejected.length})
                    </h4>
                    <ul className="space-y-2">
                        {ledger.rejected.map(({ candidate, reasons }) => (
                            <li
                                key={candidate.idempotencyKey}
                                className="rounded-md border bg-card px-3 py-2"
                            >
                                <div className="flex items-baseline gap-2">
                                    <span className={text.body}>{candidate.shiftDate}</span>
                                    <span className={cn(text.metricMono, 'text-muted-foreground')}>
                                        {candidate.startTime}–{candidate.endTime}
                                    </span>
                                </div>
                                <FindingList
                                    findings={reasons}
                                    showCalculation
                                    className="mt-1.5"
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* ── Everything else worth knowing ── */}
            {ledger.findings.length > 0 && (
                <section>
                    <h4 className={cn(text.overline, 'mb-2')}>Notes</h4>
                    <FindingList findings={ledger.findings} showCalculation />
                </section>
            )}
        </div>
    );
};

/* ────────────────────────────────────────────────────────────────────────────
   Table
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The phone composition.
 *
 * An eight-column ledger cannot become a table on a 430px screen without
 * two-dimensional scrolling, which WCAG SC 1.4.10 (Reflow) forbids and which is
 * miserable to use besides. So the shape changes rather than shrinking: one
 * card per employee, the four figures that answer "what happens to this person"
 * on a 2x2 grid, and the same detail behind the same disclosure.
 *
 * This is the composition swap `/team-availability` already makes for its
 * people x days matrix, for the same reason.
 */
const LedgerCards: React.FC<{
    proposal: BaselineProposal;
    expanded: string | null;
    setExpanded: (id: string | null) => void;
}> = ({ proposal, expanded, setExpanded }) => (
    <ul className="space-y-2 md:hidden">
        {proposal.ledgers.map(l => {
            const status = statusOf(l);
            const chip = STATUS_CHIP[status];
            const isOpen = expanded === l.employeeId;

            return (
                <li key={l.employeeId} className="rounded-lg border bg-card overflow-hidden">
                    <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : l.employeeId)}
                        className={cn(
                            touch.targetY,
                            'flex w-full items-start gap-2 px-3 py-3 text-left',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                    >
                        <ChevronRight
                            className={cn(
                                'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                                isOpen && 'rotate-90',
                            )}
                            aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                                <span className={cn(text.body, 'truncate')}>{l.name}</span>
                                <Badge variant="outline" className={cn(text.label, 'shrink-0', chip.className)}>
                                    {chip.label}
                                </Badge>
                            </div>

                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {([
                                    ['Required', fmtHours(l.requiredHours), false],
                                    ['Existing', fmtHours(l.existingHours), false],
                                    ['Proposed', fmtHours(l.proposedHours), false],
                                    [
                                        'Variance',
                                        Math.abs(l.varianceHours) <= VARIANCE_EPSILON
                                            ? '—' : fmtHm(l.varianceHours),
                                        status === 'over',
                                    ],
                                ] as const).map(([label, value, danger]) => (
                                    <div key={label} className="flex items-baseline justify-between gap-2">
                                        <dt className={text.subtle}>{label}</dt>
                                        <dd className={cn(text.metric, danger && 'text-destructive')}>
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </button>

                    {isOpen && <EmployeeDetail ledger={l} />}
                </li>
            );
        })}
    </ul>
);

export const BaselineLedgerTable: React.FC<{ proposal: BaselineProposal }> = ({ proposal }) => {
    const [expanded, setExpanded] = React.useState<string | null>(null);

    if (proposal.ledgers.length === 0) return null;

    return (
        <>
        <LedgerCards proposal={proposal} expanded={expanded} setExpanded={setExpanded} />

        <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Required</TableHead>
                        <TableHead className="text-right">Existing</TableHead>
                        <TableHead className="text-right">Leave</TableHead>
                        <TableHead className="text-right">Proposed</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {proposal.ledgers.map(l => {
                        const status = statusOf(l);
                        const chip = STATUS_CHIP[status];
                        const isOpen = expanded === l.employeeId;

                        return (
                            <React.Fragment key={l.employeeId}>
                                <TableRow
                                    className="cursor-pointer"
                                    onClick={() => setExpanded(isOpen ? null : l.employeeId)}
                                >
                                    <TableCell className="pr-0">
                                        <button
                                            type="button"
                                            aria-expanded={isOpen}
                                            aria-label={`${isOpen ? 'Hide' : 'Show'} detail for ${l.name}`}
                                            className={cn(
                                                touch.target,
                                                'flex items-center justify-center rounded',
                                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            )}
                                            onClick={e => {
                                                e.stopPropagation();
                                                setExpanded(isOpen ? null : l.employeeId);
                                            }}
                                        >
                                            <ChevronRight
                                                className={cn(
                                                    'h-4 w-4 text-muted-foreground transition-transform',
                                                    isOpen && 'rotate-90',
                                                )}
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </TableCell>
                                    <TableCell className={text.body}>{l.name}</TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(l.requiredHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(l.existingHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(l.leaveHours)}
                                    </TableCell>
                                    <TableCell className={cn(text.metric, 'text-right')}>
                                        {fmtHours(l.proposedHours)}
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            text.metric, 'text-right',
                                            status === 'over' && 'text-destructive',
                                        )}
                                    >
                                        {Math.abs(l.varianceHours) <= VARIANCE_EPSILON
                                            ? '—'
                                            : fmtHm(l.varianceHours)}
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="outline"
                                            className={cn(text.label, chip.className)}
                                        >
                                            {chip.label}
                                        </Badge>
                                    </TableCell>
                                </TableRow>

                                {isOpen && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={8} className="p-0">
                                            <EmployeeDetail ledger={l} />
                                        </TableCell>
                                    </TableRow>
                                )}
                            </React.Fragment>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
        </>
    );
};
