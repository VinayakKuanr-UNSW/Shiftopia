import React from 'react';
import { motion } from 'framer-motion';
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
    index: number;
}

function KpiCard({ title, value, sub, icon, trend, trendGoodDir = 'up', loading, accent, index }: KpiCardProps) {
    const isGood = trend && trend !== 'stable' && trend === trendGoodDir;
    const isBad  = trend && trend !== 'stable' && trend !== trendGoodDir;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.05 }}
        >
            <Card className="modern-card h-full group">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground group-hover:text-primary transition-colors">
                        {title}
                    </CardTitle>
                    <div className={`p-2 rounded-xl ${accent} shadow-inner group-hover:scale-110 transition-transform duration-300`}>
                        {icon}
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Skeleton className="h-8 w-28 mb-1 bg-primary/5" />
                    ) : (
                        <div className="text-2xl font-black text-foreground mb-1 flex items-center gap-2 tracking-tight">
                            {value}
                            {trend && (
                                <span className={`text-xs flex items-center p-1 rounded-full ${
                                    isGood ? 'bg-emerald-500/10 text-emerald-500' :
                                    isBad  ? 'bg-rose-500/10 text-rose-500' :
                                             'bg-muted/10 text-muted-foreground'
                                }`}>
                                    {trend === 'up'     && <TrendingUp  size={12} />}
                                    {trend === 'down'   && <TrendingDown size={12} />}
                                    {trend === 'stable' && <Minus size={12} />}
                                </span>
                            )}
                        </div>
                    )}
                    {sub && <p className="text-[10px] font-bold text-muted-foreground/60 leading-tight uppercase tracking-wide">{sub}</p>}
                </CardContent>
            </Card>
        </motion.div>
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
                    index={0}
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
                    index={1}
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
                    index={2}
                    title="Labour Cost"
                    value={loadingSum ? '—' : fmt$(s.estimated_cost)}
                    sub={`${s.scheduled_hours}h scheduled`}
                    icon={<DollarSign size={16} className="text-emerald-500" />}
                    accent="bg-emerald-500/10"
                    loading={loadingSum}
                />
                <KpiCard
                    index={3}
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
                    index={4}
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
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="grid grid-cols-2 md:grid-cols-4 gap-4"
            >
                <Card className="modern-card">
                    <CardContent className="pt-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Emergency Assignments</p>
                        {loadingSum ? <Skeleton className="h-7 w-16 bg-primary/5" /> :
                            <p className="text-xl font-black text-foreground tracking-tight">{s.shifts_emergency}</p>}
                    </CardContent>
                </Card>
                <Card className="modern-card">
                    <CardContent className="pt-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Avg Reliability Score</p>
                        {loadingSum ? <Skeleton className="h-7 w-16 bg-primary/5" /> :
                            <p className={`text-xl font-black tracking-tight ${s.avg_reliability_score >= 85 ? 'text-emerald-500' : s.avg_reliability_score >= 70 ? 'text-amber-500' : 'text-rose-500'}`}>
                                {s.avg_reliability_score}%
                            </p>}
                    </CardContent>
                </Card>
                <Card className="modern-card">
                    <CardContent className="pt-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Avg Swap Rate</p>
                        {loadingSum ? <Skeleton className="h-7 w-16 bg-primary/5" /> :
                            <p className="text-xl font-black text-foreground tracking-tight">{s.avg_swap_rate}%</p>}
                    </CardContent>
                </Card>
                <Card className="modern-card">
                    <CardContent className="pt-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Shifts Completed</p>
                        {loadingSum ? <Skeleton className="h-7 w-16 bg-primary/5" /> :
                            <p className="text-xl font-black text-foreground tracking-tight">{s.shifts_completed}</p>}
                    </CardContent>
                </Card>
            </motion.div>

            {/* ── Charts row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Fill Rate Trend by Department */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                >
                    <Card className="modern-card">
                        <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <TrendingUp size={16} className="text-blue-500" />
                                </div>
                                <CardTitle className="text-[11px] font-black uppercase tracking-widest text-foreground">Fill Rate Trend by Department</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {loadingTrend ? (
                                <Skeleton className="h-52 w-full bg-primary/5" />
                            ) : chartData.length === 0 ? (
                                <div className="h-52 flex items-center justify-center text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                                    No shift data in selected range
                                </div>
                            ) : (
                                <div className="h-52">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                                            <XAxis 
                                                dataKey="date" 
                                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }} 
                                                tickLine={false} 
                                                axisLine={false} 
                                                dy={10}
                                            />
                                            <YAxis 
                                                domain={[0, 100]} 
                                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }} 
                                                tickLine={false} 
                                                axisLine={false} 
                                                unit="%" 
                                            />
                                            <Tooltip
                                                contentStyle={{ 
                                                    backgroundColor: 'hsl(var(--card))', 
                                                    border: '1px solid hsl(var(--border) / 0.5)', 
                                                    borderRadius: '16px', 
                                                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3)',
                                                    backdropFilter: 'blur(12px)',
                                                    padding: '12px'
                                                }}
                                                itemStyle={{ fontSize: '12px', fontWeight: 600, padding: '2px 0' }}
                                                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 800, fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                                                formatter={(v: number) => [`${v}%`, 'Fill Rate']}
                                                cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 2, strokeDasharray: '4 4' }}
                                            />
                                            <Legend 
                                                verticalAlign="top" 
                                                align="right" 
                                                iconType="circle"
                                                content={({ payload }) => (
                                                    <div className="flex gap-4 mb-4 justify-end">
                                                        {payload?.map((entry: any, index: number) => (
                                                            <div key={`item-${index}`} className="flex items-center gap-1.5">
                                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{entry.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            />
                                            {deptNames.map((name, i) => (
                                                <Line
                                                    key={name}
                                                    type="monotone"
                                                    dataKey={name}
                                                    stroke={DEPT_COLORS[i % DEPT_COLORS.length]}
                                                    strokeWidth={3}
                                                    dot={{ r: 3, strokeWidth: 2, fill: 'hsl(var(--card))', stroke: DEPT_COLORS[i % DEPT_COLORS.length] }}
                                                    activeDot={{ r: 5, strokeWidth: 0, fill: DEPT_COLORS[i % DEPT_COLORS.length] }}
                                                    connectNulls
                                                    animationDuration={1500}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Labour Cost by Department */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
                >
                    <Card className="modern-card">
                        <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-emerald-500/10 rounded-lg">
                                    <DollarSign size={16} className="text-emerald-500" />
                                </div>
                                <CardTitle className="text-[11px] font-black uppercase tracking-widest text-foreground">Labour Cost by Department</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {loadingDepts ? (
                                <Skeleton className="h-52 w-full bg-primary/5" />
                            ) : costChartData.length === 0 ? (
                                <div className="h-52 flex items-center justify-center text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                                    No cost data available
                                </div>
                            ) : (
                                <div className="h-52">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={costChartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }} barSize={32}>
                                            <XAxis 
                                                dataKey="name" 
                                                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))', fontWeight: 600 }} 
                                                tickLine={false} 
                                                axisLine={false} 
                                                dy={10}
                                            />
                                            <YAxis 
                                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }} 
                                                tickLine={false} 
                                                axisLine={false}
                                                tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} 
                                            />
                                            <Tooltip
                                                contentStyle={{ 
                                                    backgroundColor: 'hsl(var(--card))', 
                                                    border: '1px solid hsl(var(--border) / 0.5)', 
                                                    borderRadius: '16px', 
                                                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3)',
                                                    backdropFilter: 'blur(12px)',
                                                    padding: '12px'
                                                }}
                                                itemStyle={{ fontSize: '12px', fontWeight: 600, color: 'hsl(var(--primary))' }}
                                                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 800, fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                                                formatter={(v: number) => [fmt$(v), 'Estimated Cost']}
                                                cursor={{ fill: 'hsl(var(--primary) / 0.05)', radius: 8 }}
                                            />
                                            <Bar dataKey="cost" radius={[8, 8, 0, 0]} animationDuration={1500}>
                                                {costChartData.map((_, i) => (
                                                    <Cell 
                                                        key={i} 
                                                        fill={DEPT_COLORS[i % DEPT_COLORS.length]} 
                                                        fillOpacity={0.8}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* ── Shift Status Distribution ───────────────────────────── */}
            {!loadingSum && s.shifts_total > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.6 }}
                >
                    <Card className="modern-card">
                        <CardHeader className="pb-3">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-violet-500/10 rounded-lg">
                                    <Zap size={16} className="text-violet-500" />
                                </div>
                                <CardTitle className="text-[11px] font-black uppercase tracking-widest text-foreground">Shift Status Breakdown</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                                {[
                                    { label: 'Total',      value: s.shifts_total,     color: 'text-foreground' },
                                    { label: 'Published',  value: s.shifts_published,  color: 'text-blue-500' },
                                    { label: 'Assigned',   value: s.shifts_assigned,   color: 'text-emerald-500' },
                                    { label: 'Unassigned', value: s.shifts_unassigned, color: 'text-amber-500' },
                                    { label: 'Cancelled',  value: s.shifts_cancelled,  color: 'text-rose-500' },
                                    { label: 'Completed',  value: s.shifts_completed,  color: 'text-violet-500' },
                                ].map(({ label, value, color }, i) => (
                                    <motion.div 
                                        key={label}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ duration: 0.3, delay: 0.7 + (i * 0.05) }}
                                        className="text-center p-3 rounded-2xl bg-muted/20 border border-border/10 hover:bg-muted/40 transition-colors group/stat"
                                    >
                                        <p className={`text-xl font-black ${color} group-hover:scale-110 transition-transform`}>{value}</p>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mt-1">{label}</p>
                                    </motion.div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            )}

            {/* ── Compliance flag banner ──────────────────────────────── */}
            {!loadingSum && s.compliance_overrides > 0 && (
                <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.8 }}
                    className="flex items-start gap-4 p-5 rounded-[24px] border border-amber-500/20 bg-amber-500/5 backdrop-blur-md shadow-lg shadow-amber-500/5"
                >
                    <div className="p-2 bg-amber-500/20 rounded-xl">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0" />
                    </div>
                    <div>
                        <p className="text-sm font-black uppercase tracking-tight text-amber-600 dark:text-amber-400">
                            {s.compliance_overrides} compliance override{s.compliance_overrides > 1 ? 's' : ''} in this period
                        </p>
                        <p className="text-[11px] font-bold text-muted-foreground/80 mt-1 leading-relaxed">
                            Shifts were scheduled despite rule violations. Review the Compliance tab for detailed logs and impact analysis.
                        </p>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
