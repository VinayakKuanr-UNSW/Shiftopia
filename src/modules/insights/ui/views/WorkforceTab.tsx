import React, { useMemo } from 'react';
import { Users, TrendingUp, TrendingDown, Minus, ArrowUpDown } from 'lucide-react';
import {
    Card, CardContent, CardHeader, CardTitle,
} from '@/modules/core/ui/primitives/card';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/modules/core/ui/primitives/table';
import {
    RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
    Tooltip, BarChart, Bar, XAxis, YAxis, Cell,
} from 'recharts';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import {
    useQuarterlyReport,
    getCurrentQuarter,
    REPORT_THRESHOLDS,
    getReportCellStatus,
    type QuarterlyReportRow,
} from '@/modules/users/hooks/usePerformanceMetrics';
import { useInsightsSummary } from '../../hooks/useInsightsSummary';
import type { InsightsFilters } from '../../model/metric.types';
import type { ScopeSelection } from '@/platform/auth/types';

interface WorkforceTabProps {
    filters: InsightsFilters;
    scope: ScopeSelection;
}

const STATUS_CLASSES: Record<'good' | 'warn' | 'critical', string> = {
    good:     'text-emerald-600 dark:text-emerald-400',
    warn:     'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-600 dark:text-rose-500',
};

function ReliabilityBadge({ score }: { score: number }) {
    const status = score >= 90 ? 'good' : score >= 75 ? 'warn' : 'critical';
    return (
        <span className={`font-semibold ${STATUS_CLASSES[status]}`}>
            {score.toFixed(0)}%
        </span>
    );
}

function RateCell({ value, metric }: { value: number; metric: string }) {
    const status = getReportCellStatus(metric, value);
    return (
        <span className={`tabular-nums ${STATUS_CLASSES[status]}`}>
            {value.toFixed(1)}%
        </span>
    );
}

export default function WorkforceTab({ filters, scope }: WorkforceTabProps) {
    const { year, quarter } = getCurrentQuarter();
    const { data: report, isLoading: loadingReport } = useQuarterlyReport(year, quarter, scope);
    const { data: summary, isLoading: loadingSum } = useInsightsSummary(filters);

    const s = summary ?? {
        avg_reliability_score: 0,
        avg_swap_rate: 0,
        no_show_rate: 0,
        shifts_emergency: 0,
        shifts_assigned: 0,
        shifts_total: 0,
        shift_fill_rate: 0,
    };

    const rows = report ?? [];

    // Org-level aggregates from the report table
    const orgAvg = useMemo(() => {
        if (!rows.length) return null;
        const sum = rows.reduce(
            (acc, r) => ({
                acceptance_rate: acc.acceptance_rate + r.acceptance_rate,
                no_show_rate:    acc.no_show_rate    + r.no_show_rate,
                cancel_rate:     acc.cancel_rate     + r.cancel_rate,
                swap_rate:       acc.swap_rate       + r.swap_rate,
                reliability_score: acc.reliability_score + r.reliability_score,
            }),
            { acceptance_rate: 0, no_show_rate: 0, cancel_rate: 0, swap_rate: 0, reliability_score: 0 },
        );
        const n = rows.length;
        return {
            acceptance_rate:  sum.acceptance_rate  / n,
            no_show_rate:     sum.no_show_rate     / n,
            cancel_rate:      sum.cancel_rate      / n,
            swap_rate:        sum.swap_rate        / n,
            reliability_score: sum.reliability_score / n,
        };
    }, [rows]);

    // Radar chart data for org-level averages
    const radarData = orgAvg ? [
        { metric: 'Acceptance',  value: orgAvg.acceptance_rate,  full: 100 },
        { metric: 'Reliability', value: orgAvg.reliability_score, full: 100 },
        { metric: 'On-Time',     value: 100 - orgAvg.no_show_rate, full: 100 },
        { metric: 'Commitment',  value: 100 - orgAvg.cancel_rate, full: 100 },
        { metric: 'Stability',   value: 100 - orgAvg.swap_rate,   full: 100 },
    ] : [];

    // Distribution of reliability scores for bar histogram
    const reliabilityBuckets = useMemo(() => {
        const buckets = [
            { range: '0–59',   count: 0, color: '#ef4444' },
            { range: '60–74',  count: 0, color: '#f59e0b' },
            { range: '75–89',  count: 0, color: '#3b82f6' },
            { range: '90–100', count: 0, color: '#22c55e' },
        ];
        for (const r of rows) {
            const s = r.reliability_score;
            if (s < 60)      buckets[0].count++;
            else if (s < 75) buckets[1].count++;
            else if (s < 90) buckets[2].count++;
            else             buckets[3].count++;
        }
        return buckets;
    }, [rows]);

    // Sort rows: lowest reliability first (needs attention)
    const sortedRows = useMemo(
        () => [...rows].sort((a, b) => a.reliability_score - b.reliability_score),
        [rows],
    );

    return (
        <div className="space-y-8">
            {/* ── Org-level KPI cards ─────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    {
                        label: 'Avg Acceptance Rate',
                        value: orgAvg ? `${orgAvg.acceptance_rate.toFixed(1)}%` : '—',
                        threshold: 'acceptance_rate',
                        val: orgAvg?.acceptance_rate ?? 0,
                    },
                    {
                        label: 'Avg No-Show Rate',
                        value: orgAvg ? `${orgAvg.no_show_rate.toFixed(1)}%` : '—',
                        threshold: 'no_show_rate',
                        val: orgAvg?.no_show_rate ?? 0,
                    },
                    {
                        label: 'Avg Cancel Rate',
                        value: orgAvg ? `${orgAvg.cancel_rate.toFixed(1)}%` : '—',
                        threshold: 'cancel_rate',
                        val: orgAvg?.cancel_rate ?? 0,
                    },
                    {
                        label: 'Avg Reliability Score',
                        value: orgAvg ? `${orgAvg.reliability_score.toFixed(1)}%` : '—',
                        threshold: 'reliability_score',
                        val: orgAvg?.reliability_score ?? 0,
                    },
                ].map(({ label, value, threshold, val }) => {
                    const status = getReportCellStatus(threshold, val);
                    return (
                        <Card key={label} className="bg-card border-border">
                            <CardContent className="pt-4">
                                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                                {loadingReport ? <Skeleton className="h-7 w-20" /> :
                                    <p className={`text-xl font-bold ${STATUS_CLASSES[status]}`}>{value}</p>}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* ── Charts row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Reliability distribution histogram */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Users size={16} className="text-blue-500" />
                            <CardTitle className="text-sm text-foreground">Reliability Score Distribution</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingReport ? <Skeleton className="h-48 w-full" /> : (
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={reliabilityBuckets} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                        <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            formatter={(v: number) => [v, 'Employees']}
                                        />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                            {reliabilityBuckets.map((b, i) => (
                                                <Cell key={i} fill={b.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Radar — org-level behaviour profile */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={16} className="text-violet-500" />
                            <CardTitle className="text-sm text-foreground">Org Workforce Profile (Q{quarter} {year})</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingReport ? <Skeleton className="h-48 w-full" /> : radarData.length === 0 ? (
                            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                                No data for current quarter
                            </div>
                        ) : (
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart data={radarData}>
                                        <PolarGrid stroke="var(--border)" />
                                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                                        <Radar
                                            name="Org Avg"
                                            dataKey="value"
                                            stroke="#3b82f6"
                                            fill="#3b82f6"
                                            fillOpacity={0.25}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            formatter={(v: number) => [`${v.toFixed(1)}%`, '']}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ── Employee table (sorted by lowest reliability) ─────── */}
            <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <ArrowUpDown size={16} className="text-muted-foreground" />
                        <CardTitle className="text-sm text-foreground">
                            Employee Behaviour — Q{quarter} {year}
                            <span className="font-normal text-muted-foreground ml-2">
                                ({rows.length} employees, sorted by reliability asc)
                            </span>
                        </CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {loadingReport ? (
                        <div className="space-y-2 px-4">
                            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-6 py-4">No performance data for this period.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border hover:bg-transparent">
                                        <TableHead className="text-xs">Employee</TableHead>
                                        <TableHead className="text-xs text-right">Reliability</TableHead>
                                        <TableHead className="text-xs text-right">Acceptance</TableHead>
                                        <TableHead className="text-xs text-right">No-Show</TableHead>
                                        <TableHead className="text-xs text-right">Cancel</TableHead>
                                        <TableHead className="text-xs text-right">Swap</TableHead>
                                        <TableHead className="text-xs text-right">Completed</TableHead>
                                        <TableHead className="text-xs text-right">Emergency</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedRows.map((r: QuarterlyReportRow) => (
                                        <TableRow key={r.employee_id} className="border-border text-sm">
                                            <TableCell className="font-medium text-foreground max-w-[140px] truncate">{r.employee_name}</TableCell>
                                            <TableCell className="text-right"><ReliabilityBadge score={r.reliability_score} /></TableCell>
                                            <TableCell className="text-right"><RateCell value={r.acceptance_rate} metric="acceptance_rate" /></TableCell>
                                            <TableCell className="text-right"><RateCell value={r.no_show_rate}    metric="no_show_rate" /></TableCell>
                                            <TableCell className="text-right"><RateCell value={r.cancel_rate}     metric="cancel_rate" /></TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">{r.swap_rate.toFixed(1)}%</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">{r.completed}</TableCell>
                                            <TableCell className="text-right tabular-nums text-muted-foreground">{r.emergency_assigned}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
