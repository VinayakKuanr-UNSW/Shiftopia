/**
 * How Baseline FT tells a manager why something did or did not happen.
 *
 * PLAIN ENGLISH FIRST, RULE SECOND. A manager reconciling a roster needs to
 * know that 48 minutes is below a full-time day's minimum. They do not need to
 * know it was `SHAPE_FT_MIN_DAY` that said so — until they want to check, at
 * which point they need it exactly. So the sentence leads and the clause sits
 * behind a "Why?" disclosure, rather than a rule id being dumped on the primary
 * surface where it reads as an error code.
 *
 * SEVERITY IS SHAPE AS WELL AS COLOUR. Each row carries an icon and a left
 * stripe, so the difference between "this shift was refused" and "this is worth
 * knowing" survives greyscale, low vision, and the several kinds of colour
 * blindness that make a red/amber pair identical.
 */

import React from 'react';
import { AlertTriangle, Ban, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import type { Finding, Severity } from '../../domain/types';

const SEVERITY_STYLE: Record<Severity, {
    Icon: typeof Info;
    stripe: string;
    iconColor: string;
    label: string;
}> = {
    BLOCKING: {
        Icon: Ban,
        stripe: 'border-l-destructive',
        iconColor: 'text-destructive',
        label: 'Blocked',
    },
    WARNING: {
        Icon: AlertTriangle,
        stripe: 'border-l-amber-500',
        iconColor: 'text-amber-600 dark:text-amber-500',
        label: 'Check',
    },
    INFO: {
        Icon: Info,
        stripe: 'border-l-muted-foreground/40',
        iconColor: 'text-muted-foreground',
        label: 'Note',
    },
};

/** Order findings by how much they demand of the reader, not by arrival. */
const SEVERITY_RANK: Record<Severity, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 };

export function sortFindings(findings: readonly Finding[]): Finding[] {
    return [...findings].sort((a, b) => {
        const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        return r !== 0 ? r : a.plain.localeCompare(b.plain);
    });
}

interface FindingRowProps {
    finding: Finding;
    /** Render the calculation as well as the clause. Off in dense lists. */
    showCalculation?: boolean;
}

export const FindingRow: React.FC<FindingRowProps> = ({ finding, showCalculation = false }) => {
    const [open, setOpen] = React.useState(false);
    const style = SEVERITY_STYLE[finding.severity];
    const { Icon } = style;

    // "Why?" only appears when there is genuinely something behind it. A
    // disclosure that opens onto a bare rule id teaches the reader to stop
    // opening them.
    const hasDetail = Boolean(finding.clause) || (showCalculation && finding.calculation);

    return (
        <li className={cn('border-l-2 bg-card/40 rounded-r-md', style.stripe)}>
            <div className="flex items-start gap-2.5 px-3 py-2">
                <Icon
                    className={cn('h-4 w-4 shrink-0 mt-0.5', style.iconColor)}
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    <span className="sr-only">{style.label}: </span>
                    <p className={cn(text.body, 'leading-snug')}>{finding.plain}</p>

                    {hasDetail && (
                        <>
                            <button
                                type="button"
                                onClick={() => setOpen(o => !o)}
                                aria-expanded={open}
                                className={cn(
                                    text.caption,
                                    'mt-1 inline-flex items-center gap-0.5 rounded',
                                    'hover:text-foreground focus-visible:outline-none',
                                    'focus-visible:ring-2 focus-visible:ring-ring',
                                )}
                            >
                                <ChevronRight
                                    className={cn(
                                        'h-3 w-3 transition-transform',
                                        open && 'rotate-90',
                                    )}
                                    aria-hidden="true"
                                />
                                Why?
                            </button>

                            {open && (
                                <div className="mt-1.5 space-y-1.5">
                                    {finding.clause && (
                                        <p className={text.caption}>{finding.clause}</p>
                                    )}
                                    {showCalculation && finding.calculation && (
                                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                                            {Object.entries(finding.calculation).map(([k, v]) => (
                                                <React.Fragment key={k}>
                                                    <dt className={cn(text.subtle, 'font-mono')}>
                                                        {k}
                                                    </dt>
                                                    <dd className={cn(text.subtle, 'tabular-nums')}>
                                                        {formatValue(v)}
                                                    </dd>
                                                </React.Fragment>
                                            ))}
                                        </dl>
                                    )}
                                    <p className={cn(text.subtle, 'font-mono')}>{finding.code}</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </li>
    );
};

function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.length <= 4 ? v.join(', ') : `${v.length} items`;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

interface FindingListProps {
    findings: readonly Finding[];
    showCalculation?: boolean;
    emptyLabel?: string;
    className?: string;
}

/**
 * A key that is unique even when two findings are otherwise identical.
 *
 * `BFT_RESIDUAL_VARIANCE` is emitted once per CYCLE, so an employee whose
 * window straddles two four-week cycles produces two findings with the same
 * code AND the same employeeId. Keying on those alone made React warn about
 * duplicates and left it free to drop one — which would hide a real
 * unscheduled remainder from the person reconciling the roster.
 *
 * The index is part of the key rather than a fallback for it. `sortFindings`
 * is deterministic, so it is stable across renders.
 */
export function findingKey(f: Finding, index: number): string {
    return `${f.code}-${f.candidateKey ?? f.employeeId ?? ''}-${index}`;
}

export const FindingList: React.FC<FindingListProps> = ({
    findings, showCalculation, emptyLabel, className,
}) => {
    const sorted = React.useMemo(() => sortFindings(findings), [findings]);

    if (sorted.length === 0) {
        return emptyLabel ? <p className={text.caption}>{emptyLabel}</p> : null;
    }

    return (
        <ul className={cn('space-y-1.5', className)}>
            {sorted.map((f, i) => (
                <FindingRow
                    key={findingKey(f, i)}
                    finding={f}
                    showCalculation={showCalculation}
                />
            ))}
        </ul>
    );
};
