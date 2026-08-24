/**
 * KpiTile — Modern, minimal KPI card matching the sleek analytics aesthetic.
 *
 * Encodes:
 *  1. Crisp, minimal card styling with subtle borders and clean typography.
 *  2. Ambient gradient bottom sparkline with soft glow and accent color.
 *  3. Explicit comparison delta pill (↑ / ↓) vs comparison period.
 *  4. Denominator stated for all rates.
 *  5. WCAG-compliant status indicators.
 */

import React, { useId } from 'react';
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { MetricStatus } from '@/modules/insights/model/metric-registry';

export interface KpiDelta {
    /** Signed movement against the comparison period. */
    value: number;
    /** 'points' for rate metrics (absolute pp), 'percent' for counts. */
    unit: 'points' | 'percent';
    /** What it is being compared against, e.g. "vs previous quarter". */
    label: string;
    /** Suppressed reason when denominators are too low to compare. */
    suppressedReason?: string;
}

export interface KpiTileProps {
    /** Overline/title. Sentence case. */
    label: string;
    /** Pre-formatted display value, or null/undefined for missing data. */
    value: string | null | undefined;
    /** Health of the value. 'neutral' draws no stripe and no colour. */
    status?: MetricStatus;
    /** The denominator or supporting count. Always show it for a rate. */
    denominator?: string;
    /** Period-over-period movement. Never a threshold classification. */
    delta?: KpiDelta | null;
    /** Which direction of movement is good. Decides the delta's colour. */
    deltaGoodDirection?: 'up' | 'down';
    /** Explains what the number counts. Rendered in a tooltip on the label. */
    tooltip?: string;
    /** Turns the tile into a link. */
    href?: string;
    icon?: LucideIcon;
    /** Color accent for the sparkline wave ('purple' | 'blue' | 'emerald' | 'teal' | 'rose' | 'amber'). */
    sparklineColor?: 'purple' | 'blue' | 'emerald' | 'teal' | 'rose' | 'amber';
    loading?: boolean;
    className?: string;
}

const STATUS_VALUE: Record<MetricStatus, string> = {
    good:     'text-emerald-600 dark:text-emerald-400',
    warn:     'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-600 dark:text-rose-400',
    neutral:  'text-foreground',
};

const SPARK_PALETTES = {
    purple:  { stroke: '#8b5cf6', fill1: '#8b5cf6', fill2: '#c084fc' },
    blue:    { stroke: '#3b82f6', fill1: '#3b82f6', fill2: '#60a5fa' },
    emerald: { stroke: '#10b981', fill1: '#10b981', fill2: '#34d399' },
    teal:    { stroke: '#14b8a6', fill1: '#14b8a6', fill2: '#2dd4bf' },
    rose:    { stroke: '#f43f5e', fill1: '#f43f5e', fill2: '#fb7185' },
    amber:   { stroke: '#f59e0b', fill1: '#f59e0b', fill2: '#fbbf24' },
};

function MiniSparkline({
    color = 'purple',
    trendDirection = 'up',
}: {
    color?: 'purple' | 'blue' | 'emerald' | 'teal' | 'rose' | 'amber';
    trendDirection?: 'up' | 'down' | 'flat';
}) {
    const id = useId();
    const palette = SPARK_PALETTES[color] || SPARK_PALETTES.purple;

    // Smooth wave path coordinates
    const d = trendDirection === 'up'
        ? "M 0 32 Q 25 36, 50 26 T 100 28 T 150 18 T 200 12 T 250 8 T 300 4 L 300 40 L 0 40 Z"
        : trendDirection === 'down'
        ? "M 0 6 Q 25 10, 50 16 T 100 18 T 150 26 T 200 24 T 250 32 T 300 36 L 300 40 L 0 40 Z"
        : "M 0 20 Q 25 22, 50 18 T 100 21 T 150 19 T 200 20 T 250 19 T 300 20 L 300 40 L 0 40 Z";

    const strokePath = trendDirection === 'up'
        ? "M 0 32 Q 25 36, 50 26 T 100 28 T 150 18 T 200 12 T 250 8 T 300 4"
        : trendDirection === 'down'
        ? "M 0 6 Q 25 10, 50 16 T 100 18 T 150 26 T 200 24 T 250 32 T 300 36"
        : "M 0 20 Q 25 22, 50 18 T 100 21 T 150 19 T 200 20 T 250 19 T 300 20";

    return (
        <div className="absolute inset-x-0 bottom-0 h-10 overflow-hidden pointer-events-none opacity-40 dark:opacity-30">
            <svg
                viewBox="0 0 300 40"
                preserveAspectRatio="none"
                className="w-full h-full"
                aria-hidden="true"
            >
                <defs>
                    <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette.fill1} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={palette.fill2} stopOpacity="0.0" />
                    </linearGradient>
                </defs>
                <path d={d} fill={`url(#grad-${id})`} />
                <path d={strokePath} fill="none" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" />
            </svg>
        </div>
    );
}

function DeltaBadge({ delta, goodDirection }: { delta: KpiDelta; goodDirection: 'up' | 'down' }) {
    if (delta.suppressedReason) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn(text.subtle, 'cursor-help text-xs')}>—</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                    {delta.suppressedReason}
                </TooltipContent>
            </Tooltip>
        );
    }

    const rounded = Math.round(delta.value * 10) / 10;
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    const isGood = direction !== 'flat' && direction === goodDirection;
    const isBad = direction !== 'flat' && direction !== goodDirection;
    const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

    const signed = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${delta.unit === 'points' ? 'pt' : '%'}`;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold tabular-nums cursor-help',
                        isGood ? 'text-emerald-600 dark:text-emerald-400' :
                        isBad  ? 'text-rose-600 dark:text-rose-400' :
                                 'text-muted-foreground',
                    )}
                >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{signed}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">{delta.label}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent side="top">{`${signed} ${delta.label}`}</TooltipContent>
        </Tooltip>
    );
}

export const KpiTile: React.FC<KpiTileProps> = ({
    label,
    value,
    status = 'neutral',
    denominator,
    delta,
    deltaGoodDirection = 'up',
    tooltip,
    href,
    icon: Icon,
    sparklineColor,
    loading = false,
    className,
}) => {
    const missing = value === null || value === undefined;
    const shown = missing ? '—' : value;

    // Pick sparkline color based on status or explicit prop
    const resolvedSparkColor = sparklineColor || (
        status === 'good' ? 'emerald' :
        status === 'warn' ? 'amber' :
        status === 'critical' ? 'rose' : 'purple'
    );

    const deltaDir = delta && delta.value > 0 ? 'up' : delta && delta.value < 0 ? 'down' : 'flat';

    const body = (
        <div
            className={cn(
                'group relative flex flex-col justify-between h-full min-h-[128px] overflow-hidden rounded-2xl border border-border/70 bg-card p-4 transition-all duration-200',
                'hover:border-primary/30 hover:shadow-sm',
                href && 'cursor-pointer',
                className,
            )}
        >
            {/* Top row: Label + Tooltip / Icon */}
            <div className="flex items-center justify-between gap-2 z-10">
                <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
                    {tooltip && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="inline-block cursor-help text-muted-foreground hover:text-foreground text-[11px]">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px]">{tooltip}</TooltipContent>
                        </Tooltip>
                    )}
                </div>
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />}
            </div>

            {/* Middle: Big Metric */}
            <div className="mt-2.5 z-10">
                {loading ? (
                    <Skeleton className="h-8 w-24" />
                ) : (
                    <div className={cn('text-2xl font-bold tracking-tight tabular-nums', missing ? 'text-muted-foreground' : STATUS_VALUE[status])}>
                        {shown}
                    </div>
                )}
            </div>

            {/* Bottom: Delta & Subtitle */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1 z-10">
                {delta ? (
                    <DeltaBadge delta={delta} goodDirection={deltaGoodDirection} />
                ) : denominator ? (
                    <p className="text-[11px] text-muted-foreground truncate">{denominator}</p>
                ) : null}

                {denominator && delta && (
                    <p className="text-[11px] text-muted-foreground truncate hidden xl:inline">{denominator}</p>
                )}
            </div>

            {/* Bottom Sparkline Wave */}
            {!loading && !missing && (
                <MiniSparkline color={resolvedSparkColor} trendDirection={deltaDir} />
            )}
        </div>
    );

    if (href) {
        return (
            <Link
                to={href}
                className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
                {body}
            </Link>
        );
    }

    return <div>{body}</div>;
};

export default KpiTile;
