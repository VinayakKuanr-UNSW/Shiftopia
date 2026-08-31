/**
 * The reconciliation — what one employee is owed, and what the proposal does
 * about it.
 *
 * IT LEADS WITH THE ANSWER. The previous version opened with a five-number
 * strip ending in "Still Owed 30.4h · Deficit", then listed the four shifts
 * that discharge exactly that 30.4h in a separate panel underneath. Both
 * figures were right, and the reader had to do `7.6 + 30.4 = 38` themselves to
 * discover there was never a problem — so an amber "Deficit" sat on a row about
 * to be settled perfectly. The deficit is now stated only when the proposal
 * does NOT clear it, which is the only time it is news.
 *
 * THE ARITHMETIC IS ALL STILL HERE, one disclosure down. Nothing left the audit
 * trail; it stopped being the first thing shown.
 *
 * A NON-ZERO REMAINDER IS A CORRECT ANSWER. cl 35.1(c) makes a short full-time
 * day unlawful, so when what is left is smaller than a working day the honest
 * result is to leave it unscheduled and say why.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { FindingList } from './FindingList';
import type { EmployeeLedger } from '../../api/baselineFt.commands';
import type { Candidate, CycleRequirement } from '../../domain/types';

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

/** `2026-08-31` → `Mon 31 Aug`. */
function fmtDate(iso: string): string {
    try {
        return format(parseISO(iso), 'EEE d MMM');
    } catch {
        return iso;
    }
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
        label: 'Settled',
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
   Disclosure
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A quiet toggle. Native `<details>`, so it is keyboard-operable, findable by
 * find-in-page, and carries no state of its own — three disclosures on a row
 * would otherwise be three more pieces of component state to keep in sync.
 */
const Disclosure: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <details className="group min-w-0">
        <summary
            className={cn(
                text.caption,
                'cursor-pointer list-none select-none rounded -mx-1.5 px-1.5 py-1',
                'text-muted-foreground hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
        >
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
            {label}
        </summary>
        <div className="mt-2.5">{children}</div>
    </details>
);

/* ────────────────────────────────────────────────────────────────────────────
   The sentence
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * What the proposal does to one cycle, as a line a person can read.
 *
 * The figure that matters is the residual AFTER the proposal, not the deficit
 * before it. Stating the before-figure on its own is what made a row that was
 * about to be settled exactly show an amber "Deficit".
 */
export function cycleSentence(cycle: CycleRequirement, proposed: readonly Candidate[]): {
    text: string;
    residualHours: number;
} {
    const proposedHours = proposed.reduce((s, c) => s + c.netMinutes / 60, 0);
    const residualHours = cycle.deficitHours - proposedHours;
    const owed = fmtHours(cycle.requiredHours);

    if (cycle.deficitHours <= VARIANCE_EPSILON) {
        return {
            residualHours: 0,
            text:
                `Owed ${owed}. Existing shifts, leave and public holidays already meet that, ` +
                `so nothing is proposed.`,
        };
    }

    const discharged: string[] = [];
    if (cycle.existingHours > VARIANCE_EPSILON) {
        discharged.push(`${fmtHours(cycle.existingHours)} already rostered`);
    }
    if (cycle.paidLeaveHours > VARIANCE_EPSILON) {
        discharged.push(`${fmtHours(cycle.paidLeaveHours)} leave`);
    }
    if (cycle.publicHolidayCreditHours > VARIANCE_EPSILON) {
        discharged.push(`${fmtHours(cycle.publicHolidayCreditHours)} public holidays`);
    }

    const prefix = discharged.length > 0
        ? `Owed ${owed}, with ${discharged.join(', ')}.`
        : `Owed ${owed}.`;

    if (proposed.length === 0) {
        return { residualHours, text: `${prefix} No shift could be proposed.` };
    }

    const shifts =
        `${proposed.length} shift${proposed.length === 1 ? '' : 's'} proposed, ${fmtHours(proposedHours)}`;

    return residualHours <= VARIANCE_EPSILON
        ? { residualHours: 0, text: `${prefix} ${shifts} — that settles it exactly.` }
        : {
            residualHours,
            text:
                `${prefix} ${shifts}, leaving ${fmtHm(residualHours)} unscheduled — ` +
                `a full-time day cannot be shorter than 7.6 hours.`,
        };
}

/* ────────────────────────────────────────────────────────────────────────────
   Expanded detail
   ──────────────────────────────────────────────────────────────────────────── */

export const EmployeeDetail: React.FC<{ ledger: EmployeeLedger }> = ({ ledger }) => {
    // Days the generator deliberately stepped over, said next to the dates it
    // DID take — "why is Thursday missing" is the question this panel is opened
    // to answer, and it was previously buried in a generic notes list.
    const skipped = ledger.findings.filter(
        f => f.code === 'BFT_DAY_ALREADY_ROSTERED' || f.code === 'BFT_DAY_ON_LEAVE_OR_HOLIDAY',
    );
    const notes = ledger.findings.filter(
        f => f.code !== 'BFT_DAY_ALREADY_ROSTERED' && f.code !== 'BFT_DAY_ON_LEAVE_OR_HOLIDAY',
    );

    return (
        <div className="space-y-5 px-4 py-4 sm:px-5">
            {ledger.cycles.map(cycle => {
                const proposed = ledger.proposed.filter(c => c.cycleIndex === cycle.cycleIndex);
                const { text: sentence, residualHours } = cycleSentence(cycle, proposed);

                // One shape for the whole set is the normal case, so it is said
                // once rather than repeated against every date.
                const uniform = proposed.length > 0
                    && proposed.every(c => c.startTime === proposed[0].startTime
                                        && c.endTime === proposed[0].endTime);

                return (
                    <section key={cycle.cycleIndex} className="space-y-2.5">
                        <p className={cn(text.body, 'max-w-prose')}>{sentence}</p>

                        {proposed.length > 0 && (
                            <p className={text.bodyMuted}>
                                <span className="font-mono tabular-nums">
                                    {proposed.map(c => fmtDate(c.shiftDate)).join(' · ')}
                                </span>
                                {uniform && (
                                    <span className="ml-2">
                                        all {proposed[0].startTime}–{proposed[0].endTime}
                                    </span>
                                )}
                            </p>
                        )}

                        {skipped.length > 0 && (
                            <ul className="space-y-0.5">
                                {skipped.map((f, i) => (
                                    <li key={`${f.code}-${i}`} className={text.caption}>{f.plain}</li>
                                ))}
                            </ul>
                        )}

                        <div className="flex flex-wrap items-start gap-x-6 gap-y-1 pt-0.5">
                            <Disclosure label="How this was worked out">
                                <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                                    {([
                                        ['Cycle', `${cycle.start} – ${cycle.endInclusive}`],
                                        ['Days in scope', `${cycle.activeDays} of ${cycle.cycleDays}`],
                                        ['Owed', fmtHours(cycle.requiredHours)],
                                        ['Already rostered', fmtHours(cycle.existingHours)],
                                        ['Leave credit', fmtHours(cycle.paidLeaveHours)],
                                        ['Public holidays', fmtHours(cycle.publicHolidayCreditHours)],
                                        ['Owed before this run', fmtHours(cycle.deficitHours)],
                                        ['Remaining after it', fmtHours(Math.max(0, residualHours))],
                                    ] as const).map(([label, value]) => (
                                        <div key={label} className="flex items-baseline justify-between gap-3">
                                            <dt className={text.subtle}>{label}</dt>
                                            <dd className={cn(text.metric, 'tabular-nums')}>{value}</dd>
                                        </div>
                                    ))}
                                </dl>
                                {ledger.hasUnresolvedElection && (
                                    <p className={cn(text.caption, 'mt-2 max-w-prose')}>
                                        These figures assume the employee took their religious/cultural
                                        or gender-affirmation leave as paid annual leave. Taken as
                                        unpaid leave they would owe more.
                                    </p>
                                )}
                            </Disclosure>

                            {proposed.length > 0 && (
                                <Disclosure label="Shape of each day">
                                    <ul className="space-y-1">
                                        {proposed.map(c => (
                                            <li key={c.idempotencyKey}
                                                className={cn(text.caption, 'font-mono tabular-nums')}>
                                                {fmtDate(c.shiftDate)} · {c.startTime}–{c.endTime} ·{' '}
                                                {c.unpaidBreakMinutes}m unpaid · {c.paidBreakMinutes}m paid rest ·{' '}
                                                {fmtHm(c.netMinutes / 60)} net
                                            </li>
                                        ))}
                                    </ul>
                                </Disclosure>
                            )}

                            {ledger.rejected.length > 0 && (
                                <Disclosure label={`${ledger.rejected.length} not proposed`}>
                                    <ul className="space-y-2">
                                        {ledger.rejected.map(({ candidate, reasons }) => (
                                            <li key={candidate.idempotencyKey}>
                                                <span className={cn(text.caption, 'font-mono')}>
                                                    {fmtDate(candidate.shiftDate)} ·{' '}
                                                    {candidate.startTime}–{candidate.endTime}
                                                </span>
                                                <FindingList findings={reasons} showCalculation className="mt-1" />
                                            </li>
                                        ))}
                                    </ul>
                                </Disclosure>
                            )}

                            {notes.length > 0 && (
                                <Disclosure label={`${notes.length} note${notes.length === 1 ? '' : 's'}`}>
                                    <FindingList findings={notes} showCalculation />
                                </Disclosure>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
};
