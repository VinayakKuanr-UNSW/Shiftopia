import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, UserRound } from 'lucide-react';

import { getReportCellStatus, type QuarterlyReportRow } from '@/modules/users/hooks/usePerformanceMetrics';
import { cn } from '@/modules/core/lib/utils';

export type PerformanceSortKey = keyof QuarterlyReportRow;
export type PerformanceSortDirection = 'asc' | 'desc';

export interface PerformanceColumn {
    key: PerformanceSortKey;
    label: string;
    group: string;
    isRate?: boolean;
    thresholdKey?: string;
}

interface PerformanceSortState {
    key: PerformanceSortKey;
    direction: PerformanceSortDirection;
    onChange: (key: PerformanceSortKey) => void;
}

interface PerformanceReportCardsProps {
    rows: QuarterlyReportRow[];
    columns: PerformanceColumn[];
    isLoading: boolean;
    sort: PerformanceSortState;
}

export const performanceStatusTextColor = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
} as const;

const statusCellBackground = {
    good: 'bg-emerald-500/10',
    warn: 'bg-amber-500/10',
    critical: 'bg-red-500/10',
} as const;

const groupAccent: Record<string, string> = {
    'Offer Behaviour': 'data-[active=true]:border-blue-500/40 data-[active=true]:bg-blue-500/10 data-[active=true]:text-blue-600 dark:data-[active=true]:text-blue-400',
    Assignment: 'data-[active=true]:border-purple-500/40 data-[active=true]:bg-purple-500/10 data-[active=true]:text-purple-600 dark:data-[active=true]:text-purple-400',
    Reliability: 'data-[active=true]:border-amber-500/40 data-[active=true]:bg-amber-500/10 data-[active=true]:text-amber-600 dark:data-[active=true]:text-amber-400',
    Attendance: 'data-[active=true]:border-emerald-500/40 data-[active=true]:bg-emerald-500/10 data-[active=true]:text-emerald-600 dark:data-[active=true]:text-emerald-400',
    Bidding: 'data-[active=true]:border-indigo-500/40 data-[active=true]:bg-indigo-500/10 data-[active=true]:text-indigo-600 dark:data-[active=true]:text-indigo-400',
    Overall: 'data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[active=true]:text-primary',
};

function SortIndicator({ column, sort }: { column: PerformanceSortKey; sort: PerformanceSortState }) {
    if (sort.key !== column) return <ArrowUpDown className="h-3 w-3 opacity-35" />;
    return sort.direction === 'asc'
        ? <ArrowUp className="h-3 w-3" />
        : <ArrowDown className="h-3 w-3" />;
}

function formatCellValue(row: QuarterlyReportRow, column: PerformanceColumn) {
    const value = row[column.key];
    return column.isRate ? `${Number(value).toFixed(1)}%` : Number(value);
}

function getMetricTone(row: QuarterlyReportRow, column: PerformanceColumn) {
    if (!column.thresholdKey) return '';
    const status = getReportCellStatus(column.thresholdKey, Number(row[column.key]));
    return cn(performanceStatusTextColor[status], statusCellBackground[status]);
}

function EmployeeMetricCard({
    row,
    columns,
    sort,
    isExpanded,
    onToggle,
}: {
    row: QuarterlyReportRow;
    columns: PerformanceColumn[];
    sort: PerformanceSortState;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const employeeInitial = row.employee_name?.trim().charAt(0).toUpperCase() || '?';

    return (
        <article className="overflow-hidden rounded-[24px] border border-border/50 bg-background/35 shadow-sm">
            <button
                type="button"
                onClick={onToggle}
                className={cn(
                    'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-muted/40',
                    isExpanded && 'border-b border-border/40',
                )}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} metrics for ${row.employee_name}`}
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-black text-primary">
                    {employeeInitial}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/65">
                        <UserRound className="h-3 w-3" /> Identity
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-black text-foreground">
                        {row.employee_name}
                    </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
            </button>

            {isExpanded && <div className="grid grid-cols-2 gap-2 p-3">
                {columns.map((column, index) => {
                    const spansRow = columns.length % 2 === 1 && index === columns.length - 1;
                    return (
                        <button
                            type="button"
                            key={column.key}
                            onClick={() => sort.onChange(column.key)}
                            className={cn(
                                'min-w-0 rounded-2xl bg-muted/35 px-3 py-3 text-left transition-transform active:scale-[0.98]',
                                spansRow && 'col-span-2',
                                getMetricTone(row, column),
                            )}
                        >
                            <span className="flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wider opacity-65">
                                <span className="truncate">{column.label}</span>
                                <SortIndicator column={column.key} sort={sort} />
                            </span>
                            <span className="mt-1 block text-lg font-black tabular-nums tracking-tight">
                                {formatCellValue(row, column)}
                            </span>
                        </button>
                    );
                })}
            </div>}
        </article>
    );
}

export function PerformanceReportCards({ rows, columns, isLoading, sort }: PerformanceReportCardsProps) {
    const groups = useMemo(
        () => Array.from(new Set(columns.filter(column => column.group !== 'Identity').map(column => column.group))),
        [columns],
    );
    const [activeGroup, setActiveGroup] = useState(groups.find(group => group === 'Overall') ?? groups[0] ?? '');
    const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Set<string>>(() => new Set());
    const activeColumns = columns.filter(column => column.group === activeGroup);

    const toggleEmployee = (employeeId: string) => {
        setExpandedEmployeeIds(previousIds => {
            const nextIds = new Set(previousIds);
            if (nextIds.has(employeeId)) nextIds.delete(employeeId);
            else nextIds.add(employeeId);
            return nextIds;
        });
    };

    if (isLoading) {
        return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground animate-pulse">Loading report…</div>;
    }

    if (rows.length === 0) {
        return (
            <div className="flex h-48 items-center justify-center px-8 text-center text-sm text-muted-foreground">
                No data for this quarter. Click &quot;Refresh All&quot; to populate.
            </div>
        );
    }

    return (
        <section className="space-y-3" aria-label="Employee performance report">
            <div className="rounded-[24px] border border-border/50 bg-background/35 p-3 shadow-sm">
                <div className="mb-2.5 flex items-end justify-between px-1">
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/65">Metric group</p>
                        <p className="mt-0.5 text-sm font-black text-foreground">Employee breakdown</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <p className="text-[10px] font-bold text-muted-foreground">
                            {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
                        </p>
                        <button
                            type="button"
                            onClick={() => sort.onChange('employee_name')}
                            className="flex min-h-8 items-center gap-1 rounded-lg bg-muted/45 px-2 text-[9px] font-black uppercase tracking-wider text-muted-foreground active:scale-[0.98]"
                            aria-label="Sort employees by name"
                        >
                            Name <SortIndicator column="employee_name" sort={sort} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2" aria-label="Choose a performance metric group">
                    {groups.map(group => {
                        const isActive = activeGroup === group;
                        return (
                            <button
                                type="button"
                                key={group}
                                data-active={isActive}
                                onClick={() => setActiveGroup(group)}
                                className={cn(
                                    'min-h-10 rounded-xl border border-border/45 bg-muted/25 px-2.5 py-2 text-[10px] font-black uppercase tracking-wide text-muted-foreground transition-colors active:scale-[0.98]',
                                    groupAccent[group],
                                )}
                                aria-pressed={isActive}
                            >
                                {group}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-3">
                {rows.map(row => (
                    <EmployeeMetricCard
                        key={row.employee_id}
                        row={row}
                        columns={activeColumns}
                        sort={sort}
                        isExpanded={expandedEmployeeIds.has(row.employee_id)}
                        onToggle={() => toggleEmployee(row.employee_id)}
                    />
                ))}
            </div>
        </section>
    );
}
