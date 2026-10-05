/**
 * The bird's-eye ledger: one row per employee in scope, one column per EBA
 * leave type — every kind, capped and per-occasion included.
 *
 * Each cell is the same `LedgerEntry` a My Leave card renders, compressed:
 *   balance   the balance (red when negative), "+Nh held" under it
 *   capped    hours left of the cap
 *   occasion  occasions this year, hours under it
 *   unpaid    hours taken this year
 *   —         no entitlement (e.g. annual leave for a casual)
 *
 * TWO COMPOSITIONS. From `md` up: the matrix — CSS grid, never <table>,
 * header and rows on one template so columns cannot drift, a sticky name
 * column, sideways scroll inside its own box. Below `md`: a list of employee
 * cards. On a phone the sticky name column alone would take more than half the
 * width and leave about one leave type visible at a time, so a phone gets each
 * person's four balances at a glance and taps through to the full ledger.
 */
import React from 'react';
import { AlertTriangle, ArrowDownWideNarrow, ChevronRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { LEDGER_TYPES, type LedgerEntry } from '../../domain/leave-ledger';
import { fmtH, initials } from '../format';

export interface LedgerGridRow {
    employeeId: string;
    name: string;
    avatarUrl: string | null;
    isCasual: boolean;
    entries: readonly LedgerEntry[];
}

const NAME_W = 220;
const CELL_W = 118;
const template = `${NAME_W}px repeat(${LEDGER_TYPES.length}, minmax(${CELL_W}px, 1fr))`;

function Cell({ entry }: { entry: LedgerEntry | undefined }) {
    if (!entry || !entry.applicable) {
        return <span className="text-muted-foreground/50" aria-label="Not applicable">—</span>;
    }
    const { def, line } = entry;
    if (def.type === 'long_service' && entry.lsl) {
        const l = entry.lsl;
        if (!l.serviceRecorded) return <span className="text-muted-foreground/50" aria-label="Service start not recorded">n/r</span>;
        return (
            <>
                <span className="font-semibold text-foreground">{fmtH(l.eligible ? l.availableHours : l.accruedHours)}</span>
                <span className="block text-[11px] text-muted-foreground">
                    {l.eligible ? 'available' : `from ${l.availableFrom?.slice(0, 4)}`}
                </span>
            </>
        );
    }
    if (def.type === 'fdv' && entry.fdvDays) {
        const d = entry.fdvDays;
        return (
            <>
                <span className={cn('font-semibold', d.left < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {d.left}d
                </span>
                <span className="block text-[11px] text-muted-foreground">of 10</span>
            </>
        );
    }
    if (def.kind === 'balance') {
        if (!line) return <span className="text-muted-foreground/50" aria-label="No balance recorded">—</span>;
        return (
            <>
                <span className={cn('font-semibold', line.balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {fmtH(line.balance)}
                </span>
                {line.held > 0 && (
                    <span className="block text-[11px] font-medium text-amber-600 dark:text-amber-400">+{fmtH(line.held)} held</span>
                )}
            </>
        );
    }
    if (def.kind === 'capped') {
        const over = (entry.remainingHours ?? 0) < 0;
        return (
            <>
                <span className={cn('font-semibold', over ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {fmtH(entry.remainingHours ?? 0)}
                </span>
                <span className="block text-[11px] text-muted-foreground">of {fmtH(entry.capHours ?? 0)}</span>
            </>
        );
    }
    if (def.kind === 'occasion') {
        return (
            <>
                <span className="font-semibold text-foreground">{entry.occasions}×</span>
                {entry.usedHours > 0 && <span className="block text-[11px] text-muted-foreground">{fmtH(entry.usedHours)}</span>}
            </>
        );
    }
    return entry.usedHours > 0
        ? <span className="font-semibold text-foreground">{fmtH(entry.usedHours)}</span>
        : <span className="text-muted-foreground">0h</span>;
}

type Sort = 'name' | 'annual';

export const LeaveLedgerGrid: React.FC<{
    rows: readonly LedgerGridRow[];
    onOpen: (employeeId: string) => void;
    /**
     * How many of `rows` have no `continuous_service_start`. Long service, FDV
     * in days and the 12-month service checks all need it, and production has
     * none recorded yet — so the gap is stated, not left as unexplained "n/r".
     */
    missingServiceStart?: number;
}> = ({ rows, onOpen, missingServiceStart = 0 }) => {
    const [sort, setSort] = React.useState<Sort>('name');

    const sorted = React.useMemo(() => {
        const out = [...rows];
        if (sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name));
        // Lowest annual balance first, so anyone in advance is at the top.
        // People without one (casuals, no row yet) sink to the bottom.
        const annual = (r: LedgerGridRow) => {
            const e = r.entries.find(x => x.def.type === 'annual');
            return e?.applicable && e.line ? e.line.balance : Number.POSITIVE_INFINITY;
        };
        return out.sort((a, b) => annual(a) - annual(b) || a.name.localeCompare(b.name));
    }, [rows, sort]);

    return (
        <div className="space-y-3">
            {missingServiceStart > 0 && (
                <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        {missingServiceStart === rows.length ? 'No one' : `${missingServiceStart} of ${rows.length} employees`}
                        {missingServiceStart === rows.length ? ' here has' : ' have'} a continuous service start recorded.
                        Until HR records it, long service leave shows as not recorded (n/r), FDV is shown in hours
                        rather than days, and the 12-month service checks for parental leave are skipped.
                    </p>
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={text.caption}>
                    {rows.length} employee{rows.length === 1 ? '' : 's'} · per-occasion and cl 55 leave counted this calendar year; gender affirmation over the whole of employment
                </p>
                <button
                    type="button"
                    onClick={() => setSort(sort === 'name' ? 'annual' : 'name')}
                    className={cn('inline-flex items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted/50', touch.targetY)}
                    aria-label={sort === 'name' ? 'Sort by lowest annual balance' : 'Sort by name'}
                >
                    <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden="true" />
                    {sort === 'name' ? 'Sorted by name' : 'Lowest annual first'}
                </button>
            </div>

            {rows.length === 0 ? (
                <p className={cn(text.caption, 'rounded-xl border border-dashed border-border py-10 text-center')}>
                    No employees with an active contract in this scope.
                </p>
            ) : (
                <>
                <MobileList rows={sorted} onOpen={onOpen} />
                <div className="hidden md:block overflow-x-auto rounded-xl border border-border bg-card">
                    <div role="table" aria-label="Leave ledger by employee" className="min-w-max">
                        <div role="row" className="grid border-b border-border bg-muted/60" style={{ gridTemplateColumns: template }}>
                            <div role="columnheader" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">
                                <span className={text.overline}>Employee</span>
                            </div>
                            {LEDGER_TYPES.map(def => (
                                <div key={def.type} role="columnheader" className="px-2 py-2 text-left" title={def.basis}>
                                    <span className="block text-[11px] font-bold leading-tight text-foreground">{def.label}</span>
                                    <span className="block text-[10px] text-muted-foreground">{def.clause}</span>
                                </div>
                            ))}
                        </div>

                        {sorted.map(row => (
                            <div
                                key={row.employeeId}
                                role="row"
                                className="group grid border-b border-border last:border-b-0 hover:bg-muted/30"
                                style={{ gridTemplateColumns: template }}
                            >
                                <div role="rowheader" className="sticky left-0 z-10 bg-card group-hover:bg-muted/30">
                                    <button
                                        type="button"
                                        onClick={() => onOpen(row.employeeId)}
                                        className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left', touch.targetY)}
                                        aria-label={`Open ${row.name}'s leave`}
                                    >
                                        <Avatar className="h-8 w-8 shrink-0">
                                            <AvatarImage src={row.avatarUrl ?? undefined} alt="" />
                                            <AvatarFallback className="bg-primary/10 text-primary text-[11px]">{initials(row.name)}</AvatarFallback>
                                        </Avatar>
                                        <span className="min-w-0">
                                            <span className={cn(text.body, 'block truncate')}>{row.name}</span>
                                            {row.isCasual && <span className={cn(text.subtle, 'block')}>Casual</span>}
                                        </span>
                                    </button>
                                </div>
                                {LEDGER_TYPES.map(def => (
                                    <div key={def.type} role="cell" className="px-2 py-2 text-sm tabular-nums">
                                        <Cell entry={row.entries.find(e => e.def.type === def.type)} />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
                </>
            )}
        </div>
    );
};

/** The balances a phone card shows; everything else is one tap away. */
const MOBILE_BALANCES = ['annual', 'personal', 'long_service', 'fdv'] as const;
const SHORT_LABEL: Record<(typeof MOBILE_BALANCES)[number], string> = {
    annual: 'Annual', personal: 'Personal', long_service: 'LSL', fdv: 'FDV',
};

const MobileList: React.FC<{ rows: readonly LedgerGridRow[]; onOpen: (id: string) => void }> = ({ rows, onOpen }) => (
    <ul className="space-y-2 md:hidden" aria-label="Leave ledger by employee">
        {rows.map(row => {
            const other = row.entries.filter(e =>
                e.applicable && e.def.kind !== 'balance' && (e.usedHours > 0 || e.pendingHours > 0)).length;
            return (
                <li key={row.employeeId}>
                    <button
                        type="button"
                        onClick={() => onOpen(row.employeeId)}
                        aria-label={`Open ${row.name}'s leave`}
                        className={cn('w-full rounded-xl border border-border bg-card p-3 text-left', touch.targetY)}
                    >
                        <span className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 shrink-0">
                                <AvatarImage src={row.avatarUrl ?? undefined} alt="" />
                                <AvatarFallback className="bg-primary/10 text-primary text-[11px]">{initials(row.name)}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1">
                                <span className={cn(text.body, 'block truncate')}>{row.name}</span>
                                {row.isCasual && <span className={cn(text.subtle, 'block')}>Casual</span>}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </span>
                        <span className="mt-2.5 grid grid-cols-4 gap-1.5">
                            {MOBILE_BALANCES.map(type => (
                                <span key={type} className="rounded-lg bg-muted/40 px-1.5 py-1 text-center text-sm tabular-nums">
                                    <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                        {SHORT_LABEL[type]}
                                    </span>
                                    <Cell entry={row.entries.find(e => e.def.type === type)} />
                                </span>
                            ))}
                        </span>
                        {other > 0 && (
                            <span className={cn(text.subtle, 'mt-2 block')}>
                                {other} other leave type{other === 1 ? '' : 's'} taken or pending — tap for the full ledger
                            </span>
                        )}
                    </button>
                </li>
            );
        })}
    </ul>
);
