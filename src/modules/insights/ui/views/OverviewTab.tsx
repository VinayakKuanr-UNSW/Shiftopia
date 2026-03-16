import React from 'react';
import {
    ChartBar, CheckCircle2, DollarSign, TrendingUp, TrendingDown,
    Minus, AlertTriangle, Zap, Users, Clock,
} from 'lucide-react';
import {
    Card, CardContent, CardHeader, CardTitle,
} from '@/modules/core/ui/primitives/card';
import {
    LineChart, Line, BarChart, Bar, Cell,
    ResponsiveContainer, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useInsightsSummary } from '../../hooks/useInsightsSummary';
import { useInsightsTrend } from '../../hooks/useInsightsTrend';
import { useDeptBreakdown } from '../../hooks/useDeptBreakdown';
import type { InsightsFilters } from '../../model/metric.types';

// Stable colour palette for departments
const DEPT_COLORS = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
    '#a855f7', '#14b8a6', '#f97316', '#64748b',
];

interface KpiCardProps {
    title: string;
    value: string | number;
    sub?: string;
    icon: React.ReactNode;
    trend?: 'up' | 'down' | 'stable' | null;
    trendGoodDir?: 'up' | 'down';   // which direction is "good"
    loading?: boolean;
    accent: string;   // Tailwind bg class for the icon box
}

function KpiCard({ title, value, sub, icon, trend, trendGoodDir = 'up', loading, accent }: KpiCardProps) {
    const isGood = trend && trend !== 'stable' && trend === trendGoodDir;
    const isBad  = trend && trend !== 'stable' && trend !== trendGoodDir;

    return (
        <Card className="bg-card border-border hover:bg-accent/5 transition-all duration-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <div className={`p-2 rounded-lg ${accent}`}>{icon}</div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-8 w-28 mb-1" />
                ) : (
                    <div className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                        {value}
                        {trend && (
                            <span className={`text-xs flex items-center ${
                                isGood ? 'text-emerald-500' :
                                isBad  ? 'text-rose-500' :
                                         'text-muted-foreground'
                            }`}>
                                {trend === 'up'     && <TrendingUp  size={14} />}
                                {trend === 'down'   && <TrendingDown size={14} />}
                                {trend === 'stable' && <Minus size={14} />}
                            </span>
                        )}
                    </div>
                )}
                {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            </CardContent>
        </Card>
    );
}

interface OverviewTabProps {
    filters: InsightsFilters;
}

export default function OverviewTab({ filters }: OverviewTabProps) {
    const { data: summary, isLoading: loadingSum } = useInsightsSummary(filters);
    const { data: trend,   isLoading: loadingTrend } = useInsightsTrend(filters);
    const { data: depts,   isLoading: loadingDepts } = useDeptBreakdown(filters);

    const s = summary ?? {
        shifts_total: 0, shifts_published: 0, shifts_assigned: 0, shifts_unassigned: 0,
        shifts_cancelled: 0, shifts_completed: 0, shifts_no_show: 0, shifts_emergency: 0,
        scheduled_hours: 0, estimated_cost: 0, shift_fill_rate: 0, last_minute_changes: 0,
        compliance_failures: 0, compliance_overrides: 0, no_show_rate: 0,
        avg_reliability_score: 100, avg_swap_rate: 0,
    };

    const chartData  = trend?.chart     ?? [];
    const deptNames  = trend?.deptNames ?? [];
    const deptRows   = depts ?? [];

    // Cost by dept bar chart data
    const costChartData = deptRows.map(r => ({
        name:  r.dept_name.length > 14 ? r.dept_name.slice(0, 14) + '…' : r.dept_name,
        cost:  Number(r.estimated_cost),
        fills: Number(r.fill_rate),
    }));

    function fmt$(n: number) {
        return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
    }

    return (
        <div className="space-y-8">
            {/* ── KPI row ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                <KpiCard
                    title="Shift Fill Rate"
                    value={loadingSum ? '—' : `${s.shift_fill_rate}%`}
                    sub={`${s.shifts_assigned} / ${s.shifts_published} published`}
                    icon={<ChartBar size={16} className="text-blue-500" />}
                    accent="bg-blue-500/10"
                    trend={s.shift_fill_rate >= 90 ? 'up' : s.shift_fill_rate >= 70 ? 'stable' : 'down'}
                    trendGoodDir="up"
                    loading={loadingSum}
                />
                <KpiCard
                    title="No-Show Rate"
                    value={loadingSum ? '—' : `${s.no_show_rate}%`}
                    sub={`${s.shifts_no_show} shifts missed`}
                    icon={<Users size={16} className="text-rose-500" />}
                    accent="bg-rose-500/10"
                    trend={s.no_show_rate <= 2 ? 'down' : s.no_show_rate <= 5 ? 'stable' : 'up'}
                    trendGoodDir="down"
                    loading={loadingSum}
                />
                <KpiCard
                    title="Labour Cost"
                    value={loadingSum ? '—' : fmt$(s.estimated_cost)}
                    sub={`${s.scheduled_hours}h scheduled`}
                    icon={<DollarSign size={16} className="text-emerald-500" />}
                    accent="bg-emerald-500/10"
                    loading={loadingSum}
                />
                <KpiCard
                    title="Compliance Failures"
                    value={loadingSum ? '—' : s.compliance_failures}
                    sub={`${s.compliance_overrides} override(s) approved`}
                    icon={<CheckCircle2 size={16} className={s.compliance_failures > 0 ? 'text-amber-500' : 'text-emerald-500'} />}
                    accent={s.compliance_failures > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}
                    trend={s.compliance_failures === 0 ? 'down' : 'up'}
                    trendGoodDir="down"
                    loading={loadingSum}
                />
                <KpiCard
                    title="Last-Minute Changes"
                    value={loadingSum ? '—' : s.last_minute_changes}
                    sub="Edits/unassigns within 24h"
                    icon={<Clock size={16} className="text-orange-500" />}
                    accent="bg-orange-500/10"
                    trend={s.last_minute_changes <= 5 ? 'down' : 'up'}
                    trendGoodDir="down"
                    loading={loadingSum}
                />
            </div>

            {/* ── Secondary metrics row ───────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">Emergency Assignments</p>
                        {loadingSum ? <Skeleton className="h-7 w-16" /> :
                            <p className="text-xl font-bold text-foreground">{s.shifts_emergency}</p>}
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">Avg Reliability Score</p>
                        {loadingSum ? <Skeleton className="h-7 w-16" /> :
                            <p className={`text-xl font-bold ${s.avg_reliability_score >= 85 ? 'text-emerald-600 dark:text-emerald-400' : s.avg_reliability_score >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {s.avg_reliability_score}%
                            </p>}
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">Avg Swap Rate</p>
                        {loadingSum ? <Skeleton className="h-7 w-16" /> :
                            <p className="text-xl font-bold text-foreground">{s.avg_swap_rate}%</p>}
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">Shifts Completed</p>
                        {loadingSum ? <Skeleton className="h-7 w-16" /> :
                            <p className="text-xl font-bold text-foreground">{s.shifts_completed}</p>}
                    </CardContent>
                </Card>
            </div>

            {/* ── Charts row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Fill Rate Trend by Department */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={16} className="text-blue-500" />
                            <CardTitle className="text-sm text-foreground">Fill Rate Trend by Department</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingTrend ? (
                            <Skeleton className="h-52 w-full" />
                        ) : chartData.length === 0 ? (
                            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                                No shift data in selected range
                            </div>
                        ) : (
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} unit="%" />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                                            formatter={(v: number) => [`${v}%`, '']}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        {deptNames.map((name, i) => (
                                            <Line
                                                key={name}
                                                type="monotone"
                                                dataKey={name}
                                                stroke={DEPT_COLORS[i % DEPT_COLORS.length]}
                                                strokeWidth={2}
                                                dot={{ r: 3 }}
                                                connectNulls
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Labour Cost by Department */}
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <DollarSign size={16} className="text-emerald-500" />
                            <CardTitle className="text-sm text-foreground">Labour Cost by Department</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingDepts ? (
                            <Skeleton className="h-52 w-full" />
                        ) : costChartData.length === 0 ? (
                            <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                                No cost data available
                            </div>
                        ) : (
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={costChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false}
                                            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                                            labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                                            formatter={(v: number) => [fmt$(v), 'Cost']}
                                        />
                                        <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                                            {costChartData.map((_, i) => (
                                                <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ── Shift Status Distribution ───────────────────────────── */}
            {!loadingSum && s.shifts_total > 0 && (
                <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Zap size={16} className="text-violet-500" />
                            <CardTitle className="text-sm text-foreground">Shift Status Breakdown</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                            {[
                                { label: 'Total',      value: s.shifts_total,     color: 'text-foreground' },
                                { label: 'Published',  value: s.shifts_published,  color: 'text-blue-600 dark:text-blue-400' },
                                { label: 'Assigned',   value: s.shifts_assigned,   color: 'text-emerald-600 dark:text-emerald-400' },
                                { label: 'Unassigned', value: s.shifts_unassigned, color: 'text-amber-600 dark:text-amber-400' },
                                { label: 'Cancelled',  value: s.shifts_cancelled,  color: 'text-rose-600 dark:text-rose-400' },
                                { label: 'Completed',  value: s.shifts_completed,  color: 'text-violet-600 dark:text-violet-400' },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="text-center p-3 rounded-lg bg-muted/40">
                                    <p className={`text-xl font-bold ${color}`}>{value}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{label}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Compliance flag banner ──────────────────────────────── */}
            {!loadingSum && s.compliance_overrides > 0 && (
                <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                            {s.compliance_overrides} compliance override{s.compliance_overrides > 1 ? 's' : ''} in this period
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Shifts were scheduled despite rule violations. Review the Compliance tab for details.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
