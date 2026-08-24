/**
 * The manager's per-employee performance table — 28 columns in seven groups,
 * rendered as a band on KPI > Overview.
 *
 * Named for what it is. It was `PerformanceTab`, which was wrong twice over:
 * it is not a tab (it is a band inside one), and it sat one letter from
 * `PerformancePage`, the employee-facing page showing a person their OWN
 * numbers. Two different audiences, near-identical names.
 */
import React, { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Info, Search } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    useQuarterlyReport,
    getReportCellStatus,
    type QuarterlyReportRow,
} from '@/modules/users/hooks/usePerformanceMetrics';
import type { ScopeSelection } from '@/platform/auth/types';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { PerformanceReportCards } from '@/modules/users/ui/components/PerformanceReportCards';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

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

const groupBgColorsLight: Record<string, string> = {
    'Identity': 'bg-[#e2e8f0]',
    'Offer Behaviour': 'bg-[#e0f2fe]',
    'Assignment': 'bg-[#f3e8ff]',
    'Trading': 'bg-[#fce7f3]',
    'Reliability': 'bg-[#fef3c7]',
    'Attendance': 'bg-[#dcfce7]',
    'Bidding': 'bg-[#e0e7ff]',
    'Overall': 'bg-[#e2e8f0]',
};

const groupBgColorsDark: Record<string, string> = {
    'Identity': 'bg-[#101622]',
    'Offer Behaviour': 'bg-[#131d2e]',
    'Assignment': 'bg-[#1c142e]',
    'Trading': 'bg-[#221223]',
    'Reliability': 'bg-[#221810]',
    'Attendance': 'bg-[#112217]',
    'Bidding': 'bg-[#12192e]',
    'Overall': 'bg-[#151c27]',
};

const groupTextColors: Record<string, string> = {
    'Identity': 'text-muted-foreground',
    'Offer Behaviour': 'text-blue-700 dark:text-blue-400',
    'Assignment': 'text-purple-700 dark:text-purple-400',
    'Trading': 'text-pink-700 dark:text-pink-400',
    'Reliability': 'text-amber-700 dark:text-amber-400',
    'Attendance': 'text-emerald-700 dark:text-emerald-400',
    'Bidding': 'text-indigo-700 dark:text-indigo-400',
    'Overall': 'text-primary',
};

/* ═══════════════════ COLUMN DEFINITIONS ═══════════════════ */
interface ColumnDef {
    key: SortKey;
    label: string;
    group: string;
    isRate?: boolean;
    thresholdKey?: string;
}

interface EmployeePerformanceTableProps {
    scope: ScopeSelection;
    selectedYear: number;
    selectedQuarter: number;
}

export default function EmployeePerformanceTable({ scope, selectedYear, selectedQuarter }: EmployeePerformanceTableProps) {
    const [sortKey, setSortKey] = useState<SortKey>('employee_name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [searchTerm, setSearchTerm] = useState('');
    const { isDark } = useTheme();
    const { t } = useTranslation();
    // A 28-column table needs two-dimensional scrolling at 320px, which
    // SC 1.4.10 forbids. PerformanceReportCards is the card composition of the
    // same rows and columns — it existed with zero importers until now.
    const isMobile = useIsMobile();

    const row1Ref = React.useRef<HTMLTableRowElement>(null);
    const [row1Height, setRow1Height] = useState(29);

    React.useEffect(() => {
        if (row1Ref.current) {
            setRow1Height(row1Ref.current.offsetHeight);
        }
    }, [scope, selectedYear, selectedQuarter]);

    const columns: ColumnDef[] = [
        // Identity
        { key: 'employee_name', label: t('nav.users'), group: 'Identity' },
        // Offer Behaviour
        { key: 'total_offers', label: 'Offers Received', group: 'Offer Behaviour' },
        { key: 'acceptance_rate', label: 'Acceptance %', group: 'Offer Behaviour', isRate: true, thresholdKey: 'acceptance_rate' },
        { key: 'rejection_rate', label: 'Rejection %', group: 'Offer Behaviour', isRate: true, thresholdKey: 'rejection_rate' },
        { key: 'ignorance_rate', label: 'Ignore %', group: 'Offer Behaviour', isRate: true, thresholdKey: 'offer_expiration_rate' },
        // Assignment
        { key: 'assigned', label: 'Assigned Shifts', group: 'Assignment' },
        { key: 'emergency_assigned', label: 'Emergency Assigned', group: 'Assignment' },
        { key: 'standard_drop_rate', label: 'Standard Drop %', group: 'Assignment', isRate: true, thresholdKey: 'standard_drop_rate' },
        { key: 'urgent_drop_rate', label: 'Urgent Drop %', group: 'Assignment', isRate: true, thresholdKey: 'urgent_drop_rate' },
        { key: 'assignment_changes', label: 'Assignment Changes', group: 'Assignment' },
        // Trading
        { key: 'trade_requests', label: 'Trade Requests', group: 'Trading' },
        { key: 'trade_completion_rate', label: 'Trade Completion %', group: 'Trading', isRate: true },
        { key: 'trade_cancellation_rate', label: 'Trade Cancellation %', group: 'Trading', isRate: true },
        // Attendance
        { key: 'completed', label: 'Shifts Worked', group: 'Attendance' },
        { key: 'no_show_rate', label: 'No-Show %', group: 'Attendance', isRate: true, thresholdKey: 'no_show_rate' },
        { key: 'on_time_in_rate', label: 'On-Time In %', group: 'Attendance', isRate: true, thresholdKey: 'on_time_in_rate' },
        { key: 'on_time_out_rate', label: 'On-Time Out %', group: 'Attendance', isRate: true, thresholdKey: 'on_time_out_rate' },
        { key: 'early_clock_in_rate', label: 'Early In %', group: 'Attendance', isRate: true, thresholdKey: 'early_clock_in_rate' },
        { key: 'late_clock_in_rate', label: 'Late In %', group: 'Attendance', isRate: true, thresholdKey: 'late_clock_in_rate' },
        { key: 'early_clock_out_rate', label: 'Early Out %', group: 'Attendance', isRate: true, thresholdKey: 'early_clock_out_rate' },
        { key: 'late_clock_out_rate', label: 'Late Out %', group: 'Attendance', isRate: true, thresholdKey: 'late_clock_out_rate' },
        { key: 'auto_clock_out_rate', label: 'Auto Clock-Out %', group: 'Attendance', isRate: true, thresholdKey: 'auto_clock_out_rate' },
        // Bidding
        { key: 'total_bids', label: 'Bids Submitted', group: 'Bidding' },
        { key: 'bid_success_rate', label: 'Bid Success %', group: 'Bidding', isRate: true, thresholdKey: 'bid_success_rate' },
        { key: 'bids_accepted', label: 'Winning Bids', group: 'Bidding' },
        // Overall
        { key: 'performance_score', label: 'Performance Score', group: 'Overall', isRate: true, thresholdKey: 'performance_score' },
        { key: 'reliability_score', label: 'Reliability Score', group: 'Overall', isRate: true, thresholdKey: 'reliability_score' },
        { key: 'engagement_score', label: 'Engagement Score', group: 'Overall', isRate: true, thresholdKey: 'engagement_score' },
    ];

    const { data: rows = [], isLoading, isError, error, refetch } = useQuarterlyReport(selectedYear, selectedQuarter, scope);

    /* ─── Filtering & Sorting ─── */
    const filteredRows = useMemo(() => {
        if (!searchTerm.trim()) return rows;
        const query = searchTerm.toLowerCase();
        return rows.filter(r => 
            (r.employee_name || '').toLowerCase().includes(query)
        );
    }, [rows, searchTerm]);

    const sortedRows = useMemo(() => {
        const copy = [...filteredRows];
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
    }, [filteredRows, sortKey, sortDir]);

    /* ─── Summary Row ─── */
    const summary = useMemo(() => {
        if (rows.length === 0) return null;
        const avg = (fn: (r: QuarterlyReportRow) => number) =>
            rows.reduce((s, r) => s + fn(r), 0) / rows.length;

        return {
            acceptance_rate: avg(r => r.acceptance_rate),
            standard_drop_rate: avg(r => r.standard_drop_rate || 0),
            urgent_drop_rate: avg(r => r.urgent_drop_rate || 0),
            attendance_compliance_rate: avg(r => r.attendance_compliance_rate || 0),
            performance_score: avg(r => r.performance_score || 0),
            reliability_score: avg(r => r.reliability_score),
            engagement_score: avg(r => r.engagement_score || 0),
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

    const groups: { name: string; span: number }[] = [];
    let prev = '';
    for (const c of columns) {
        if (c.group !== prev) { groups.push({ name: c.group, span: 1 }); prev = c.group; }
        else { groups[groups.length - 1].span++; }
    }

    return (
        <div className="flex flex-col space-y-4">
            {/* ═══ SUMMARY ROW ═══ */}
            {summary && (
                <TooltipProvider>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {([
                            { label: 'Avg Performance', value: summary.performance_score, key: 'performance_score' },
                            { label: 'Avg Reliability', value: summary.reliability_score, key: 'reliability_score' },
                            { label: 'Avg Engagement', value: summary.engagement_score, key: 'engagement_score' },
                            { label: 'Avg Acceptance', value: summary.acceptance_rate, key: 'acceptance_rate' },
                            { label: 'Avg Standard Drop', value: summary.standard_drop_rate, key: 'standard_drop_rate' },
                            { label: 'Avg Urgent Drop', value: summary.urgent_drop_rate, key: 'urgent_drop_rate' },
                        ] as const).map(s => {
                            const st = getReportCellStatus(s.key, s.value);
                            return (
                                <div
                                    key={s.key}
                                    className={cn(
                                        'rounded-[24px] border p-5 transition-all',
                                        isDark 
                                            ? "bg-[#1c2333]/40 border-white/5 shadow-lg" 
                                            : "bg-white/70 backdrop-blur-md border-white shadow-md",
                                        st === 'good' ? 'bg-emerald-500/5' :
                                            st === 'warn' ? 'bg-amber-500/5' :
                                                'bg-red-500/5',
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-1.5">
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-black opacity-60">{s.label}</p>
                                        {s.key === 'performance_score' && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Info className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help transition-colors" />
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-[280px] text-[11px] p-3 leading-relaxed">
                                                    <p className="font-bold mb-1">Performance Score Formula</p>
                                                    <div className="space-y-1 font-mono text-[11px]">
                                                        <p>• Reliability: 35% (Cancel/No-Show)</p>
                                                        <p>• Acceptance: 25% (Offer Response)</p>
                                                        <p>• Attendance: 20% (Punctuality)</p>
                                                        <p>• Bid Success: 20% (Marketplace Fit)</p>
                                                    </div>
                                                    <p className="mt-2 opacity-70 italic">Weighted average of all behavioral and operational KPIs.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                    <p className={cn('text-3xl font-black tabular-nums tracking-tight', statusTextColor[st])}>
                                        {s.value.toFixed(1)}%
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-1 font-medium">Team Average · Selected Scope</p>
                                </div>
                            );
                        })}
                    </div>
                </TooltipProvider>
            )}

            {/* ═══ TABLE ═══ */}
            <div className={cn(
                "rounded-[32px] border transition-all overflow-hidden flex flex-col",
                isDark 
                    ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                    : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
            )}>
                {/* Search Bar */}
                {!isLoading && rows.length > 0 && (
                    <div className="p-4 border-b border-border/30 flex items-center bg-muted/5">
                        <div className="relative w-full max-w-xs">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search users..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={cn(
                                    "w-full pl-9 pr-4 py-1.5 bg-background border border-border/40 rounded-xl text-xs transition-all",
                                    "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40",
                                    "placeholder:text-muted-foreground font-medium"
                                )}
                            />
                        </div>
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm animate-pulse">Loading report…</p>
                    </div>
                ) : isError ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-2">
                        <p className="text-red-500 text-sm font-semibold">Couldn't load the performance report.</p>
                        <p className="text-muted-foreground text-xs max-w-sm text-center">
                            {error instanceof Error ? error.message : 'An unexpected error occurred.'}
                        </p>
                        <button
                            onClick={() => refetch()}
                            className="mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                ) : filteredRows.length === 0 ? (
                    <div className="flex items-center justify-center h-48">
                        <p className="text-muted-foreground text-sm">
                            {rows.length === 0
                                ? 'No activity recorded for this quarter yet.'
                                : 'No users match your search query.'}
                        </p>
                    </div>
                ) : isMobile ? (
                    <div className="p-3">
                        <PerformanceReportCards
                            rows={sortedRows}
                            columns={columns}
                            isLoading={isLoading}
                            sort={{ key: sortKey, direction: sortDir, onChange: handleSort }}
                        />
                    </div>
                ) : (
                    <div className="overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr ref={row1Ref} className="border-b border-border/50">
                                    {groups.map((g, index) => (
                                        <th
                                            key={g.name}
                                            colSpan={g.span}
                                            className={cn(
                                                'px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-center border-r border-border/30 last:border-r-0',
                                                index === 0
                                                    ? 'sticky left-0 top-0 z-30 border-r-2 border-r-border/80 border-b border-b-border/30 w-48 min-w-[12rem] px-4 text-left'
                                                    : 'sticky top-0 z-20 border-b border-b-border/30',
                                                isDark ? groupBgColorsDark[g.name] : groupBgColorsLight[g.name],
                                                groupTextColors[g.name] || '',
                                            )}
                                        >
                                            {g.name}
                                        </th>
                                    ))}
                                </tr>
                                <tr className="border-b border-border bg-muted/20">
                                    <TooltipProvider>
                                        {columns.map((col, cIdx) => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                style={{ top: `${row1Height - 0.5}px` }}
                                                className={cn(
                                                    "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none whitespace-nowrap border-r border-border/20 last:border-r-0",
                                                    isDark ? groupBgColorsDark[col.group] : groupBgColorsLight[col.group],
                                                    cIdx === 0
                                                        ? "sticky left-0 z-30 border-r-2 border-r-border/80 border-b-2 border-b-border/80 w-48 min-w-[12rem] px-4 text-left shadow-[4px_0_8px_-3px_rgba(0,0,0,0.15)]"
                                                        : "sticky z-20 border-b-2 border-b-border/80"
                                                )}
                                            >
                                                <div className="flex items-center gap-1">
                                                    {col.label}
                                                    {col.key === 'performance_score' && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Info className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help ml-0.5" />
                                                            </TooltipTrigger>
                                                            <TooltipContent className="text-[11px] p-2">
                                                                Weighted: Reliability (35%), Acceptance (25%), Attendance (20%), Bid Success (20%)
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                    <SortIcon col={col.key} />
                                                </div>
                                            </th>
                                        ))}
                                    </TooltipProvider>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((row, idx) => (
                                    <tr
                                        key={row.employee_id}
                                        className={cn(
                                            'group/row border-b border-border/30 hover:bg-muted/20 transition-colors',
                                            idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/5',
                                        )}
                                    >
                                        {columns.map((col, cIdx) => (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    'px-3 py-2.5 whitespace-nowrap tabular-nums font-semibold border-r border-border/10 last:border-r-0',
                                                    col.key === 'employee_name' ? 'font-bold text-foreground' : '',
                                                    cIdx === 0
                                                        ? cn(
                                                            'sticky left-0 z-10 border-r-2 border-r-border/80 transition-colors shadow-[4px_0_8px_-3px_rgba(0,0,0,0.12)] w-48 min-w-[12rem] px-4 text-left',
                                                            isDark
                                                                ? (idx % 2 === 0 ? 'bg-[#151c27]' : 'bg-[#121822]')
                                                                : (idx % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'),
                                                            'group-hover/row:bg-slate-200/50 dark:group-hover/row:bg-[#1e2738]'
                                                        )
                                                        : '',
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
            <div className="flex justify-end pt-2">
                <p className="text-[11px] text-muted-foreground font-black uppercase tracking-widest">
                    {rows.length} {rows.length === 1 ? 'Employee' : 'Employees'} &bull; Q{selectedQuarter} {selectedYear}
                </p>
            </div>
        </div>
    );
}
