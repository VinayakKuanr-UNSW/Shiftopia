/**
 * KpiDetailTable — the "who exactly" band, shared by all four behavioural tabs.
 *
 * Driven by a column spec keyed on metric ids, so every cell is graded by the
 * one registry rather than by a per-table threshold lookup. Sorting defaults to
 * the column that most needs attention, which is why `defaultSort` takes a
 * direction: on a lower-is-better metric the worst rows are the highest.
 *
 * Below the mobile breakpoint the table becomes cards. A 6-column table at
 * 320px would need two-dimensional scrolling, which SC 1.4.10 forbids.
 */

import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import {
    statusFor,
    formatMetric,
    labelFor,
    type MetricStatus,
} from '../../model/metric-registry';

export interface KpiColumn {
    /** Registry metric id, or a bare key for an ungraded count. */
    key: string;
    /** Overrides the registry label. */
    header?: string;
    /** Ungraded columns render plain, with no colour and no stripe. */
    graded?: boolean;
}

export interface KpiDetailRow {
    id: string;
    name: string;
    values: Record<string, number>;
}

interface KpiDetailTableProps {
    rows: KpiDetailRow[];
    columns: KpiColumn[];
    /** Column to sort by on first render. */
    defaultSort: { key: string; dir: 'asc' | 'desc' };
    /** Shown above the table, e.g. "12 employees · Q3 2026". */
    caption: string;
    emptyMessage: string;
}

const STATUS_CELL: Record<MetricStatus, string> = {
    good:     'text-emerald-600 dark:text-emerald-400',
    warn:     'text-amber-600 dark:text-amber-400 bg-amber-500/5',
    critical: 'text-rose-600 dark:text-rose-400 bg-rose-500/5',
    neutral:  'text-foreground',
};

export const KpiDetailTable: React.FC<KpiDetailTableProps> = ({
    rows,
    columns,
    defaultSort,
    caption,
    emptyMessage,
}) => {
    const isMobile = useIsMobile();
    const [query, setQuery] = useState('');
    const [sortKey, setSortKey] = useState(defaultSort.key);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort.dir);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    }, [rows, query]);

    const sorted = useMemo(() => {
        const copy = [...filtered];
        copy.sort((a, b) => {
            if (sortKey === 'name') {
                return sortDir === 'asc'
                    ? a.name.localeCompare(b.name)
                    : b.name.localeCompare(a.name);
            }
            const av = a.values[sortKey] ?? 0;
            const bv = b.values[sortKey] ?? 0;
            return sortDir === 'asc' ? av - bv : bv - av;
        });
        return copy;
    }, [filtered, sortKey, sortDir]);

    const toggleSort = (key: string) => {
        if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('desc'); }
    };

    const cellStatus = (col: KpiColumn, value: number): MetricStatus =>
        col.graded === false ? 'neutral' : statusFor(col.key, value);

    if (rows.length === 0) {
        return (
            <p className={cn(text.bodyMuted, 'rounded-2xl border border-border bg-muted/30 p-4')}>
                {emptyMessage}
            </p>
        );
    }

    const search = (
        <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
                className={cn(
                    'w-full rounded-xl border border-border bg-background pl-9 pr-3',
                    text.body, touch.targetY,
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                )}
            />
        </div>
    );

    // ── Mobile: cards, not a horizontally scrolling table ───────────────────
    if (isMobile) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    {search}
                    <span className={text.caption}>{sorted.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                    {sorted.map((r) => (
                        <li key={r.id} className="rounded-2xl border border-border bg-card p-3">
                            <p className={cn(text.body, 'font-semibold text-foreground')}>{r.name}</p>
                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                                {columns.map((col) => {
                                    const v = r.values[col.key] ?? 0;
                                    return (
                                        <div key={col.key} className="flex items-baseline justify-between gap-2">
                                            <dt className={cn(text.caption, 'truncate')}>
                                                {col.header ?? labelFor(col.key)}
                                            </dt>
                                            <dd className={cn('tabular-nums text-sm font-semibold', STATUS_CELL[cellStatus(col, v)])}>
                                                {formatMetric(col.key, v)}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    // ── Desktop: table ──────────────────────────────────────────────────────
    const SortIcon = ({ col }: { col: string }) => {
        if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3 w-3 text-primary" aria-hidden="true" />
            : <ArrowDown className="h-3 w-3 text-primary" aria-hidden="true" />;
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {search}
                <span className={text.caption}>{caption}</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="border-b border-border">
                            <th
                                scope="col"
                                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left"
                            >
                                <button
                                    type="button"
                                    onClick={() => toggleSort('name')}
                                    className={cn('flex items-center gap-1.5', text.overline, 'hover:text-foreground')}
                                >
                                    Employee <SortIcon col="name" />
                                </button>
                            </th>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    scope="col"
                                    aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    className="whitespace-nowrap px-4 py-2.5 text-right"
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleSort(col.key)}
                                        className={cn('ml-auto flex items-center gap-1.5', text.overline, 'hover:text-foreground')}
                                    >
                                        {col.header ?? labelFor(col.key)} <SortIcon col={col.key} />
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((r) => (
                            <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                                <th
                                    scope="row"
                                    className={cn('sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-semibold', text.body)}
                                >
                                    {r.name}
                                </th>
                                {columns.map((col) => {
                                    const v = r.values[col.key] ?? 0;
                                    return (
                                        <td
                                            key={col.key}
                                            className={cn(
                                                'whitespace-nowrap px-4 py-2.5 text-right text-sm font-semibold tabular-nums',
                                                STATUS_CELL[cellStatus(col, v)],
                                            )}
                                        >
                                            {formatMetric(col.key, v)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {sorted.length === 0 && (
                <p className={cn(text.bodyMuted, 'px-1')}>No one matches “{query}”.</p>
            )}
        </div>
    );
};

export default KpiDetailTable;
