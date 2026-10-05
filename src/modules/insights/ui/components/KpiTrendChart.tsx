/**
 * KpiTrendChart — the Band B series, shared by every KPI tab.
 *
 * Owns the three things every chart in this module was previously getting
 * wrong or repeating:
 *
 *  1. THEMING. `--card`, `--border` and `--muted-foreground` are bare HSL
 *     triplets ("222 47% 11%"), valid only inside hsl(). Two of the old tabs
 *     passed `var(--card)` straight to Recharts contentStyle, which resolves
 *     to an invalid colour and rendered tooltips with no background. Every
 *     token used here goes through hsl().
 *
 *  2. REDUCED MOTION. Recharts animationDuration was hardcoded to 1500ms with
 *     no guard.
 *
 *  3. A DATA TABLE. An SVG with no text is nothing to a screen reader, so each
 *     chart ships a visually-hidden table carrying the same numbers.
 */

import React, { useMemo } from 'react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';

/** Semantic-safe series colours. Kept apart from good/warn/critical status. */
export const SERIES_COLORS = {
    primary: '#3b82f6',
    good:    '#22c55e',
    warn:    '#f59e0b',
    bad:     '#ef4444',
    muted:   '#94a3b8',
    accent:  '#a855f7',
} as const;

export interface TrendSeries {
    /** Key into each row of `data`. */
    key: string;
    label: string;
    color: string;
    /** 'bar' and 'line' may be mixed; 'area' series stack with each other. */
    type: 'area' | 'bar' | 'line';
    /** Renders on the right-hand axis. Only meaningful for 'line'. */
    rightAxis?: boolean;
    unit?: '%' | '';
}

interface KpiTrendChartProps {
    data: Array<Record<string, string | number>>;
    /** Key holding the bucket label, e.g. 'bucket'. */
    xKey: string;
    series: TrendSeries[];
    height?: number;
    /** Used as the accessible caption for the hidden data table. */
    caption: string;
    /** Shown instead of the chart when there is nothing to plot. */
    emptyMessage: string;
    className?: string;
}

const usePrefersReducedMotion = () => {
    const [reduced, setReduced] = React.useState(false);
    React.useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduced(mq.matches);
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
};

const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

export const KpiTrendChart: React.FC<KpiTrendChartProps> = ({
    data,
    xKey,
    series,
    height = 260,
    caption,
    emptyMessage,
    className,
}) => {
    const reduced = usePrefersReducedMotion();
    const animation = reduced ? 0 : 600;

    // Nothing plotted is different from a flat line at zero: if every series is
    // zero in every bucket there is no shape to read, so say so instead.
    const hasData = useMemo(
        () => data.some((row) => series.some((s) => Number(row[s.key] ?? 0) !== 0)),
        [data, series],
    );

    const tooltipStyle = {
        backgroundColor: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 12,
        fontSize: 12,
        color: 'hsl(var(--foreground))',
    };

    const hasRightAxis = series.some((s) => s.rightAxis);
    const areas = series.filter((s) => s.type === 'area');
    const bars = series.filter((s) => s.type === 'bar');
    const lines = series.filter((s) => s.type === 'line');
    const mixed = (bars.length > 0 && lines.length > 0) || hasRightAxis;

    const chart = (() => {
        if (areas.length > 0 && bars.length === 0 && lines.length === 0) {
            return (
                <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    {areas.map((s) => (
                        <Area
                            key={s.key} type="monotone" dataKey={s.key} name={s.label}
                            stackId="1" stroke={s.color} fill={s.color} fillOpacity={0.5}
                            animationDuration={animation}
                        />
                    ))}
                </AreaChart>
            );
        }

        if (mixed) {
            return (
                <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} />
                    {hasRightAxis && (
                        <YAxis yAxisId="right" orientation="right" unit="%" domain={[0, 100]}
                               tick={axisTick} tickLine={false} axisLine={false} />
                    )}
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    {bars.map((s) => (
                        <Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.label}
                             fill={s.color} stackId="b" radius={[3, 3, 0, 0]}
                             animationDuration={animation} />
                    ))}
                    {lines.map((s) => (
                        <Line key={s.key} yAxisId={s.rightAxis ? 'right' : 'left'} type="monotone"
                              dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
                              dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls
                              animationDuration={animation} />
                    ))}
                </ComposedChart>
            );
        }

        return (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                {bars.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color}
                         stackId="b" radius={[3, 3, 0, 0]} animationDuration={animation} />
                ))}
            </BarChart>
        );
    })();

    return (
        <div className={cn('rounded-2xl border border-border bg-card p-4', className)}>
            {hasData ? (
                <div style={{ height }} aria-hidden="true">
                    <ResponsiveContainer width="100%" height="100%">
                        {chart}
                    </ResponsiveContainer>
                </div>
            ) : (
                <div
                    className={cn('flex items-center justify-center', text.bodyMuted)}
                    style={{ height }}
                >
                    {emptyMessage}
                </div>
            )}

            {/* The chart's numbers, reachable without seeing it. */}
            <table className="sr-only">
                <caption>{caption}</caption>
                <thead>
                    <tr>
                        <th scope="col">Period</th>
                        {series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => (
                        <tr key={String(row[xKey])}>
                            <th scope="row">{String(row[xKey])}</th>
                            {series.map((s) => (
                                <td key={s.key}>{row[s.key] ?? 0}{s.unit ?? ''}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default KpiTrendChart;
