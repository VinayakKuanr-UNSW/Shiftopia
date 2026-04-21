import React, { useState, useMemo } from 'react';
import { BarChart3, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { cn } from '@/modules/core/lib/utils';
import {
    useQuarterlyReport,
    getCurrentQuarter,
    getReportCellStatus,
    type QuarterlyReportRow,
} from '@/modules/users/hooks/usePerformanceMetrics';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Button } from '@/modules/core/ui/primitives/button';

/* ═══════════════════ TYPES ═══════════════════ */
type SortKey = keyof QuarterlyReportRow;
type SortDir = 'asc' | 'desc';

/* ═══════════════════ COLOR HELPERS ═══════════════════ */
const statusTextColor = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    critical: 'text-red-600 dark:text-red-400',
} as const;

const statusCellBg = {
    good: 'bg-emerald-500/5',
    warn: 'bg-amber-500/5',
    critical: 'bg-red-500/5',
} as const;

/* ═══════════════════ COLUMN DEFINITIONS ═══════════════════ */
interface ColumnDef {
    key: SortKey;
    label: string;
    group: string;
    isRate?: boolean;
    thresholdKey?: string;
}

const COLUMNS: ColumnDef[] = [
    // Identity
    { key: 'employee_name', label: 'Employee', group: 'Identity' },
    // Offer Behaviour
    { key: 'offers_sent', label: 'Offers', group: 'Offer Behaviour' },
    { key: 'acceptance_rate', label: 'Accept %', group: 'Offer Behaviour', isRate: true, thresholdKey: 'acceptance_rate' },
    { key: 'rejection_rate', label: 'Reject %', group: 'Offer Behaviour', isRate: true },
    { key: 'ignorance_rate', label: 'Ignored %', group: 'Offer Behaviour', isRate: true },
    // Assignment
    { key: 'assigned', label: 'Assigned', group: 'Assignment' },
    { key: 'emergency_assigned', label: 'Emergency', group: 'Assignment' },
    // Reliability
    { key: 'cancel_rate', label: 'Cancel %', group: 'Reliability', isRate: true, thresholdKey: 'cancel_rate' },
    { key: 'late_cancel_rate', label: 'Late Cancel %', group: 'Reliability', isRate: true, thresholdKey: 'late_cancel_rate' },
    { key: 'swap_rate', label: 'Swap %', group: 'Reliability', isRate: true },
    { key: 'reliability_score', label: 'Score', group: 'Reliability', isRate: true, thresholdKey: 'reliability_score' },
    // Attendance
    { key: 'late_clock_in_rate', label: 'Late In %', group: 'Attendance', isRate: true },
    { key: 'early_clock_out_rate', label: 'Early Out %', group: 'Attendance', isRate: true },
    { key: 'no_show_rate', label: 'No-Show %', group: 'Attendance', isRate: true, thresholdKey: 'no_show_rate' },
];

/* ═══════════════════ QUARTER OPTIONS ═══════════════════ */
const buildQuarterOptions = () => {
    const opts: { year: number; quarter: number; label: string }[] = [];
    const { year, quarter } = getCurrentQuarter();
    for (let i = 0; i < 5; i++) {
        let q = quarter - i;
        let y = year;
        while (q <= 0) { q += 4; y -= 1; }
        opts.push({ year: y, quarter: q, label: `Q${q} ${y}` });
    }
    return opts;
};

/* ═══════════════════ MAIN COMPONENT ═══════════════════ */
const PerformancePage: React.FC = () => {
    const queryClient = useQueryClient();
    const quarterOptions = useMemo(buildQuarterOptions, []);
    const defaultQ = quarterOptions[0];

    const [selectedYear, setSelectedYear] = useState(defaultQ.year);
    const [selectedQuarter, setSelectedQuarter] = useState(defaultQ.quarter);
    const [sortKey, setSortKey] = useState<SortKey>('employee_name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { data: rows = [], isLoading } = useQuarterlyReport(selectedYear, selectedQuarter, scope);

    /* ─── Sorting ─── */
    const sortedRows = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'string' && typeof bv === 'string') {
                return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            }
            const an = Number(av) || 0;
            const bn = Number(bv) || 0;
            return sortDir === 'asc' ? an - bn : bn - an;
        });
        return copy;
    }, [rows, sortKey, sortDir]);

    /* ─── Summary Row ─── */
    const summary = useMemo(() => {
        if (rows.length === 0) return null;
        const avg = (fn: (r: QuarterlyReportRow) => number) =>
            rows.reduce((s, r) => s + fn(r), 0) / rows.length;
        return {
            acceptance_rate: avg(r => r.acceptance_rate),
            cancel_rate: avg(r => r.cancel_rate),
            no_show_rate: avg(r => r.no_show_rate),
            reliability_score: avg(r => r.reliability_score),
        };
    }, [rows]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const handleQuarterChange = (val: string) => {
        const opt = quarterOptions.find(o => o.label === val);
        if (opt) { setSelectedYear(opt.year); setSelectedQuarter(opt.quarter); }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            // Metrics refresh logic removed as shift_events table is decommissioned.
            await queryClient.invalidateQueries({
                queryKey: ['quarterly_performance_report'],
            });
        } catch (err) {
            console.error('Refresh error:', err);
        } finally {
            setIsRefreshing(false);
        }
    };

    /* ─── Render ─── */
    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortDir === 'asc'
            ? <ArrowUp className="w-3 h-3 text-primary" />
            : <ArrowDown className="w-3 h-3 text-primary" />;
    };

    const cellValue = (row: QuarterlyReportRow, col: ColumnDef) => {
        const v = row[col.key];
        if (col.isRate) return `${Number(v).toFixed(1)}%`;
        if (col.key === 'employee_name') return v;
        return Number(v);
    };

    const cellClass = (row: QuarterlyReportRow, col: ColumnDef) => {
        if (!col.thresholdKey) return '';
        const v = Number(row[col.key]);
        const st = getReportCellStatus(col.thresholdKey, v);
        return cn(statusTextColor[st], statusCellBg[st]);
    };

    // Build group headers
    const groups: { name: string; span: number }[] = [];
    let prev = '';
    for (const c of COLUMNS) {
        if (c.group !== prev) { groups.push({ name: c.group, span: 1 }); prev = c.group; }
        else { groups[groups.length - 1].span++; }
    }

    const groupColors: Record<string, string> = {
        'Identity': 'bg-muted/30',
        'Offer Behaviour': 'bg-blue-500/5 text-blue-600 dark:text-blue-400',
        'Assignment': 'bg-purple-500/5 text-purple-600 dark:text-purple-400',
        'Reliability': 'bg-amber-500/5 text-amber-600 dark:text-amber-400',
        'Attendance': 'bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
    };

    return (
        <div className="w-full min-h-screen p-4 md:p-6 lg:p-8 space-y-6 pb-24 md:pb-8">
            {/* ═══ SCOPE FILTER ═══ */}
            <ScopeFilterBanner
                mode="managerial"
                onScopeChange={setScope}
                hidden={isGammaLocked}
            />

            {/* ═══ HEADER ═══ */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg">
                        <BarChart3 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-foreground tracking-tight">Performance</h1>
                        <p className="text-sm text-muted-foreground font-medium">Quarterly employee metrics overview</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Select
                        value={`Q${selectedQuarter} ${selectedYear}`}
                        onValueChange={handleQuarterChange}
                    >
                        <SelectTrigger className="w-40 bg-card border-border/50 h-10 rounded-xl text-sm font-semibold">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border text-foreground rounded-xl">
                            {quarterOptions.map(o => (
                                <SelectItem key={o.label} value={o.label} className="font-semibold">
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="h-10 px-4 rounded-xl gap-2"
                    >
                        <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                        Refresh All
                    </Button>
                </div>
            </div>

            {/* ═══ SUMMARY ROW ═══ */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {([
                        { label: 'Avg Acceptance', value: summary.acceptance_rate, key: 'acceptance_rate' },
                        { label: 'Avg Cancellation', value: summary.cancel_rate, key: 'cancel_rate' },
                        { label: 'Avg No-Show', value: summary.no_show_rate, key: 'no_show_rate' },
                        { label: 'Avg Reliability', value: summary.reliability_score, key: 'reliability_score' },
                    ] as const).map(s => {
                        const st = getReportCellStatus(s.key, s.value);
                        return (
                            <div
                                key={s.key}
                                className={cn(
                                    'rounded-xl border p-4 text-center transition-colors',
                                    st === 'good' ? 'bg-emerald-500/10 border-emerald-500/20' :
                                        st === 'warn' ? 'bg-amber-500/10 border-amber-500/20' :
                                            'bg-red-500/10 border-red-500/20',
                                )}
                            >
                                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{s.label}</p>
                                <p className={cn('text-2xl font-black tabular-nums', statusTextColor[st])}>
                                    {s.value.toFixed(1)}%
                                </p>
                                <p className="text-[9px] text-muted-foreground mt-0.5">Company Average</p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ═══ TABLE ═══ */}
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm animate-pulse">Loading report…</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm">No data for this quarter. Click "Refresh All" to populate.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            {/* Group Headers */}
                            <thead>
                                <tr className="border-b border-border/50">
                                    {groups.map(g => (
                                        <th
                                            key={g.name}
                                            colSpan={g.span}
                                            className={cn(
                                                'px-3 py-2 text-[9px] font-black uppercase tracking-widest text-center border-r border-border/30 last:border-r-0',
                                                groupColors[g.name] || '',
                                            )}
                                        >
                                            {g.name}
                                        </th>
                                    ))}
                                </tr>
                                {/* Column Headers */}
                                <tr className="border-b border-border bg-muted/20">
                                    {COLUMNS.map(col => (
                                        <th
                                            key={col.key}
                                            onClick={() => handleSort(col.key)}
                                            className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-muted/40 transition-colors select-none whitespace-nowrap"
                                        >
                                            <div className="flex items-center gap-1">
                                                {col.label}
                                                <SortIcon col={col.key} />
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, idx) => (
                                    <tr
                                        key={row.employee_id}
                                        className={cn(
                                            'border-b border-border/30 hover:bg-muted/20 transition-colors',
                                            idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/5',
                                        )}
                                    >
                                        {COLUMNS.map(col => (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    'px-3 py-2.5 whitespace-nowrap tabular-nums font-semibold',
                                                    col.key === 'employee_name' ? 'font-bold text-foreground' : '',
                                                    cellClass(row, col),
                                                )}
                                            >
                                                {cellValue(row, col)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ═══ FOOTER ═══ */}
            <p className="text-[10px] text-muted-foreground text-right">
                {rows.length} employee{rows.length !== 1 ? 's' : ''} · Q{selectedQuarter} {selectedYear}
            </p>
        </div>
    );
};

export default PerformancePage;
