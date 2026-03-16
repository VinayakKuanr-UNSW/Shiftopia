import React from 'react';
import { ShieldCheck, DollarSign, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';
import {
    Card, CardContent, CardHeader, CardTitle,
} from '@/modules/core/ui/primitives/card';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/modules/core/ui/primitives/table';
import {
    BarChart, Bar, XAxis, YAxis, Cell,
    ResponsiveContainer, Tooltip, LineChart, Line, Legend,
} from 'recharts';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useInsightsSummary } from '../../hooks/useInsightsSummary';
import { useDeptBreakdown } from '../../hooks/useDeptBreakdown';
import { useInsightsTrend } from '../../hooks/useInsightsTrend';
import type { InsightsFilters } from '../../model/metric.types';

const DEPT_COLORS = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
    '#a855f7', '#14b8a6', '#f97316', '#64748b',
];

interface ComplianceCostTabProps {
    filters: InsightsFilters;
}

function fmt$(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1000)      return `$${(n / 1000).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
}

export default function ComplianceCostTab({ filters }: ComplianceCostTabProps) {
    const { data: summary,  isLoading: loadingSum   } = useInsightsSummary(filters);
    const { data: depts,    isLoading: loadingDepts  } = useDeptBreakdown(filters);
    const { data: trend,    isLoading: loadingTrend  } = useInsightsTrend(filters);

    const s       = summary ?? { compliance_failures: 0, compliance_overrides: 0, estimated_cost: 0, scheduled_hours: 0 };
    const deptRows = depts   ?? [];
    const chartData = trend?.chart     ?? [];
    const deptNames = trend?.deptNames ?? [];

    const totalCost = deptRows.reduce((sum, r) => sum + Number(r.estimated_cost), 0);

    // Cost breakdown bar chart
    const costBarData = deptRows.map((r, i) => ({
        name:  r.dept_name.length > 14 ? r.dept_name.slice(0, 14) + '…' : r.dept_name,
        cost:  Number(r.estimated_cost),
        color: DEPT_COLORS[i % DEPT_COLORS.length],
    }));

    // Cost trend chart — sum across depts per day
    const costTrendData = chartData.map(point => {
        const dayTotal = deptNames.reduce((sum, name) => {
            const val = point[`${name}_cost`];
            return sum + (typeof val === 'number' ? val : 0);
        }, 0);
        return { date: point.date, total: dayTotal };
    });

    return (
        <div className="space-y-8">
            {/* ── Compliance KPI row ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className={`bg-card border-border ${!loadingSum && s.compliance_failures > 0 ? 'border-amber-500/40' : ''}`}>
                    <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-muted-foreground">Compliance Failures</p>
                            {!loadingSum && s.compliance_failures > 0
                                ? <AlertTriangle size={14} className="text-amber-500" />
                                : <CheckCircle2  size={14} className="text-emerald-500" />}
                        </div>
                        {loadingSum ? <Skeleton className="h-7 w-12" /> :
                            <p className={`text-2xl font-bold ${s.compliance_failures > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {s.compliance_failures}
                            </p>}
                        <p className="text-xs text-muted-foreground mt-1">Unresolved violations</p>
                    </CardContent>
                </Card>

                <Card className={`bg-card border-border ${!loadingSum && s.compliance_overrides > 0 ? 'border-rose-500/30' : ''}`}>
                    <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-muted-foreground">Override Approvals</p>
                            <ShieldCheck size={14} className="text-muted-foreground" />
                        </div>
                        {loadingSum ? <Skeleton className="h-7 w-12" /> :
                            <p className={`text-2xl font-bold ${s.compliance_overrides > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                                {s.compliance_overrides}
                            </p>}
                        <p className="text-xs text-muted-foreground mt-1">Manager-approved exceptions</p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-muted-foreground">Total Labour Cost</p>
                            <DollarSign size={14} className="text-emerald-500" />
                        </div>
                        {loadingDepts ? <Skeleton className="h-7 w-20" /> :
                            <p className="text-2xl font-bold text-foreground">{fmt$(totalCost)}</p>}
                        <p className="text-xs text-muted-foreground mt-1">Across {deptRows.length} departments</p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-muted-foreground">Cost per Scheduled Hour</p>
                            <TrendingUp size={14} className="text-blue-500" />
                        </div>
                        {loadingSum ? <Skeleton className="h-7 w-20" /> :
                            <p className="text-2xl font-bold text-foreground">
                                {s.scheduled_hours > 0 ? fmt$(s.estimated_cost / s.scheduled_hours) : '—'}
                            </p>}
                        <p className="text-xs text-muted-foreground mt-1">{s.scheduled_hours}h total scheduled</p>
                    </CardContent>
                </Card>
            </div>

            {/* ── Compliance explanation ──────────────────────────────── */}
            {!loadingSum && (s.compliance_failures > 0 || s.compliance_overrides > 0) && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-500" />
                        <p className="text-sm font-medium text-foreground">Compliance Notes</p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                        {s.compliance_failures > 0 && (
                            <div className="flex items-start gap-2">
                                <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400 shrink-0">
                                    {s.compliance_failures} Failed
                                </Badge>
                                <p className="text-xs text-muted-foreground">
                                    Shifts have compliance snapshots showing rule violations that were not overridden.
                                    These may include rest gap, max hours, or visa hour breaches.
                                </p>
                            </div>
                        )}
                        {s.compliance_overrides > 0 && (
                            <div className="flex items-start gap-2">
                                <Badge variant="outline" className="border-rose-500/50 text-rose-600 dark:text-rose-400 shrink-0">
                                    {s.compliance_overrides} Overridden
                                </Badge>
                                <p className="text-xs text-muted-foreground">
                                    Managers approved exceptions to compliance rules.
                                    Each override requires a recorded reason for audit purposes.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Charts row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cost by department bar chart */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <DollarSign size={16} className="text-emerald-500" />
                            <CardTitle className="text-sm text-foreground">Labour Cost by Department</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingDepts ? <Skeleton className="h-52 w-full" /> :
                        costBarData.length === 0 ? (
                            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>
                        ) : (
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={costBarData} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false}
                                            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                                        <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            formatter={(v: number) => [fmt$(v), 'Cost']}
                                        />
                                        <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                            {costBarData.map((row, i) => <Cell key={i} fill={row.color} />)}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Daily cost trend */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={16} className="text-blue-500" />
                            <CardTitle className="text-sm text-foreground">Daily Labour Cost Trend</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingTrend ? <Skeleton className="h-52 w-full" /> :
                        costTrendData.length === 0 ? (
                            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No trend data</div>
                        ) : (
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={costTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false}
                                            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            formatter={(v: number) => [fmt$(v), 'Daily Cost']}
                                        />
                                        <Line type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ── Department breakdown table ──────────────────────────── */}
            <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <DollarSign size={16} className="text-emerald-500" />
                        <CardTitle className="text-sm text-foreground">Department Breakdown</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="px-0">
                    {loadingDepts ? (
                        <div className="space-y-2 px-4">
                            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                    ) : deptRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground px-6 py-4">No department data for selected range.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border hover:bg-transparent">
                                        <TableHead className="text-xs">Department</TableHead>
                                        <TableHead className="text-xs text-right">Total Shifts</TableHead>
                                        <TableHead className="text-xs text-right">Fill Rate</TableHead>
                                        <TableHead className="text-xs text-right">Labour Cost</TableHead>
                                        <TableHead className="text-xs text-right">No-Shows</TableHead>
                                        <TableHead className="text-xs text-right">Emergency</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {deptRows.map(r => {
                                        const fillColor =
                                            r.fill_rate >= 90 ? 'text-emerald-600 dark:text-emerald-400' :
                                            r.fill_rate >= 70 ? 'text-amber-600 dark:text-amber-400' :
                                                                'text-rose-600 dark:text-rose-400';
                                        return (
                                            <TableRow key={r.dept_id} className="border-border text-sm">
                                                <TableCell className="font-medium text-foreground">{r.dept_name}</TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground">{r.shifts_total}</TableCell>
                                                <TableCell className={`text-right tabular-nums font-medium ${fillColor}`}>{r.fill_rate}%</TableCell>
                                                <TableCell className="text-right tabular-nums text-foreground font-medium">{fmt$(Number(r.estimated_cost))}</TableCell>
                                                <TableCell className={`text-right tabular-nums ${r.no_show_count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                                    {r.no_show_count}
                                                </TableCell>
                                                <TableCell className={`text-right tabular-nums ${r.emergency_count > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                                                    {r.emergency_count}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
