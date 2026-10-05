/**
 * The ledger as cards — one per EBA leave type this person is entitled to.
 *
 * Each kind reads differently because the Agreement counts each differently
 * (see `leave-ledger.ts`):
 *   balance   the balance, red and "In advance" when negative; held + available
 *   capped    hours left of the calendar-year cap
 *   occasion  occasions and hours taken this year, against the per-occasion figure
 *   unpaid    hours taken this year
 *
 * Types the person has no entitlement to are not shown at all. A zero card for
 * a casual's annual leave would read as "used up", which is false.
 *
 * Cards are tinted by kind (see `LEDGER_TONE`). In the personal view each carries a
 * "Request" pill that opens the request sheet already set to that type.
 *
 * THE BASIS IS REACHABLE ON TOUCH. On a pointer device it is the hover
 * tooltip; a phone has no hover, so below `sm` each card carries a
 * "How this works" toggle that shows the same sentence inline.
 */
import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import type { LedgerEntry } from '../../domain/leave-ledger';
import type { LeaveTypeCode } from '../../model/leave.types';
import { fmtH } from '../format';

export function periodLabel(def: LedgerEntry['def']): string {
    switch (def.kind) {
        case 'balance':
            return def.type === 'fdv' ? 'Per year of employment'
                : def.type === 'long_service' ? 'Accrues with service' : 'Balance';
        case 'capped': return def.capPeriod === 'tenure' ? 'Whole of employment' : 'Per calendar year';
        case 'occasion': return 'Per occasion';
        default: return 'Unpaid';
    }
}

export function LedgerFigure({ entry }: { entry: LedgerEntry }) {
    const { def, line } = entry;

    if (def.type === 'fdv' && entry.fdvDays) {
        // cl 46.2 counts DAYS, so days are what the person is told.
        const d = entry.fdvDays;
        return (
            <>
                <p className={cn('text-3xl font-bold tracking-tight tabular-nums', d.left < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {d.left}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">day{d.left === 1 ? '' : 's'} left of 10</span>
                </p>
                <p className={cn(text.caption, 'tabular-nums')}>
                    {d.taken} taken{d.pending > 0 ? ` · ${d.pending} pending` : ''} since {d.yearStart}
                </p>
            </>
        );
    }

    if (def.type === 'long_service' && entry.lsl) {
        const l = entry.lsl;
        if (!l.serviceRecorded) {
            return (
                <>
                    <p className="text-3xl font-bold tracking-tight tabular-nums text-muted-foreground">—</p>
                    <p className={text.caption}>Continuous service start not recorded — ask HR</p>
                </>
            );
        }
        return (
            <>
                <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                    {l.eligible ? fmtH(l.availableHours) : fmtH(l.accruedHours)}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">
                        {l.eligible ? 'available' : 'accrued'}
                    </span>
                </p>
                <p className={cn(text.caption, 'tabular-nums')}>
                    {l.eligible
                        ? `${fmtH(l.accruedHours)} accrued · ${fmtH(l.takenHours)} taken${l.pendingHours > 0 ? ` · ${fmtH(l.pendingHours)} pending` : ''}`
                        : `${l.years} years' service · available from ${l.availableFrom}`}
                </p>
                {l.estimated && <p className={text.caption}>Estimate — casual LSL uses average weekly hours</p>}
            </>
        );
    }

    if (def.kind === 'balance') {
        if (!line) {
            return (
                <>
                    <p className="text-3xl font-bold tracking-tight tabular-nums text-muted-foreground">—</p>
                    <p className={text.caption}>No balance recorded yet</p>
                </>
            );
        }
        const negative = line.balance < 0;
        return (
            <>
                <p className={cn('text-3xl font-bold tracking-tight tabular-nums',
                    negative ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {fmtH(line.balance)}
                </p>
                {negative && <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">In advance</p>}
                {line.held > 0 && (
                    <p className="text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-300">
                        {fmtH(line.held)} held · {fmtH(line.available)} available
                    </p>
                )}
            </>
        );
    }

    if (def.kind === 'capped') {
        const over = (entry.remainingHours ?? 0) < 0;
        return (
            <>
                <p className={cn('text-3xl font-bold tracking-tight tabular-nums',
                    over ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {fmtH(entry.remainingHours ?? 0)}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">left of {fmtH(entry.capHours ?? 0)}</span>
                </p>
                <p className={cn(text.caption, 'tabular-nums')}>
                    {fmtH(entry.usedHours)} taken{entry.pendingHours > 0 ? ` · ${fmtH(entry.pendingHours)} pending` : ''}
                </p>
            </>
        );
    }

    if (def.kind === 'occasion') {
        return (
            <>
                <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                    {entry.occasions}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">
                        occasion{entry.occasions === 1 ? '' : 's'} this year
                    </span>
                </p>
                <p className={cn(text.caption, 'tabular-nums')}>
                    {fmtH(entry.usedHours)} taken{entry.pendingHours > 0 ? ` · ${fmtH(entry.pendingHours)} pending` : ''}
                </p>
            </>
        );
    }

    return (
        <>
            <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                {fmtH(entry.usedHours)}
                <span className="ml-1 text-xs font-medium text-muted-foreground">this year</span>
            </p>
            {entry.pendingHours > 0 && (
                <p className={cn(text.caption, 'tabular-nums')}>{fmtH(entry.pendingHours)} pending</p>
            )}
        </>
    );
}

/**
 * One pastel per KIND, not per type — the colour says how the card is counted,
 * so the same tint always reads the same way — the request dialog reuses it. The period line on every card
 * says it in words too; colour is never the only signal.
 */
export const LEDGER_TONE: Record<LedgerEntry['def']['kind'], string> = {
    balance: 'bg-sky-50 border-sky-100 dark:bg-sky-400/[0.14] dark:border-sky-300/25',
    capped: 'bg-violet-50 border-violet-100 dark:bg-violet-400/[0.14] dark:border-violet-300/25',
    occasion: 'bg-orange-50 border-orange-100 dark:bg-orange-300/[0.12] dark:border-orange-200/20',
    unpaid: 'bg-teal-50 border-teal-100 dark:bg-teal-300/[0.10] dark:border-teal-200/20',
};

const LedgerCard: React.FC<{ entry: LedgerEntry; onRequest?: (type: LeaveTypeCode) => void }> = ({ entry, onRequest }) => {
    const [explained, setExplained] = React.useState(false);
    const basisId = `ledger-basis-${entry.def.type}`;
    const negative = Boolean(entry.line && entry.line.balance < 0);
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <article
                    tabIndex={0}
                    aria-label={entry.def.label}
                    className={cn(
                        'flex min-h-[12.5rem] flex-col rounded-3xl border p-5 outline-none',
                        'transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
                        LEDGER_TONE[entry.def.kind],
                        negative && 'border-red-400/60 dark:border-red-400/40',
                    )}
                >
                    <div className="flex items-center justify-between gap-2">
                        <p className={text.caption}>{periodLabel(entry.def)}</p>
                        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{entry.def.clause}</span>
                    </div>
                    <p className="mt-1 text-lg font-bold leading-snug tracking-tight text-foreground">{entry.def.label}</p>

                    <div className="mt-auto space-y-0.5 pt-4">
                        <LedgerFigure entry={entry} />
                    </div>

                    <div className={cn('mt-4 flex items-center gap-2', !onRequest && 'sm:hidden')}>
                        {onRequest && (
                            <button
                                type="button"
                                onClick={() => onRequest(entry.def.type)}
                                aria-label={`Request ${entry.def.label}`}
                                className={cn(
                                    'flex-1 rounded-full bg-white px-4 text-sm font-semibold text-foreground shadow-sm',
                                    'transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                    'dark:bg-white/10 dark:hover:bg-white/15',
                                    touch.targetY,
                                )}
                            >
                                Request
                            </button>
                        )}
                        <button
                            type="button"
                            className={cn('sm:hidden px-2 text-xs font-semibold text-primary', !onRequest && '-ml-2', touch.targetY)}
                            aria-expanded={explained}
                            aria-controls={basisId}
                            onClick={() => setExplained(v => !v)}
                        >
                            {explained ? 'Hide' : 'How this works'}
                        </button>
                    </div>
                    {explained && (
                        <p id={basisId} className={cn(text.caption, 'mt-2 sm:hidden')}>{entry.def.basis}</p>
                    )}
                </article>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="hidden sm:block max-w-xs text-xs">{entry.def.basis}</TooltipContent>
        </Tooltip>
    );
};

export const LedgerCards: React.FC<{
    entries: readonly LedgerEntry[];
    className?: string;
    /** Personal view only: each card gets a "Request" pill preset to its type. */
    onRequest?: (type: LeaveTypeCode) => void;
}> = ({ entries, className, onRequest }) => {
    const shown = entries.filter(e => e.applicable);
    return (
        <section aria-label="Leave ledger" className={cn('grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4', className)}>
            {shown.map(entry => <LedgerCard key={entry.def.type} entry={entry} onRequest={onRequest} />)}
        </section>
    );
};
