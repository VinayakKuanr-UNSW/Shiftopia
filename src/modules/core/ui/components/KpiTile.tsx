/**
 * KpiTile — the one KPI card in the app.
 *
 * Replaces nine rival implementations: OverviewTab.KpiCard, WorkforceTab's
 * inline card, ComplianceCostTab's inline card, PerformanceTab's summary tile,
 * BidsBentoStats.MetricCard, TeamCoverageSummary.Tile, AttendanceMetricsBar's
 * tile, AwardDashboardHeader.StatCard and broadcasts/StatCard.
 *
 * Four rules it encodes, each fixing something the old cards got wrong:
 *
 *  1. THE DELTA IS A COMPARISON, NEVER A THRESHOLD.
 *     Overview's arrows were threshold classifications wearing a trend icon —
 *     a 95% fill rate showed a green "up" arrow whether it had risen or
 *     fallen. Movement and health are two different facts, so they get two
 *     different encodings: the arrow is movement, the stripe is health.
 *
 *  2. EVERY RATE STATES ITS DENOMINATOR.
 *     "3.2%" is unreadable without "of 375 held shifts". This is also the
 *     guard against the fill-rate card shipping again with a subtitle that
 *     contradicted its own arithmetic.
 *
 *  3. ZERO AND MISSING ARE DIFFERENT.
 *     A real zero renders "0.0%". Missing data renders an em dash. The old
 *     placeholderData of all-zeros made a loading tile, a failed query and a
 *     genuine zero identical on screen.
 *
 *  4. STATUS IS NOT COLOUR ALONE (WCAG 1.4.1).
 *     A severity stripe carries the same information as the value colour, and
 *     the status word is in the accessible label.
 */

import React from 'react';
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
    /** What it is being compared against, e.g. "vs Q1 2026". */
    label: string;
    /**
     * Suppressed when either period is too small to compare. The tile shows
     * why rather than a meaningless swing.
     */
    suppressedReason?: string;
}

export interface KpiTileProps {
    /** Overline. Sentence case; the component uppercases it. */
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
    /** Turns the tile into a link, typically to the metric drill-down. */
    href?: string;
    icon?: LucideIcon;
    loading?: boolean;
    className?: string;
}

const STATUS_VALUE: Record<MetricStatus, string> = {
    good:     'text-emerald-600 dark:text-emerald-400',
    warn:     'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-600 dark:text-rose-400',
    neutral:  'text-foreground',
};

const STATUS_STRIPE: Record<MetricStatus, string> = {
    good:     'bg-emerald-500',
    warn:     'bg-amber-500',
    critical: 'bg-rose-500',
    neutral:  'bg-transparent',
};

const STATUS_WORD: Record<MetricStatus, string> = {
    good:     'on target',
    warn:     'needs attention',
    critical: 'off target',
    neutral:  '',
};

function DeltaBadge({ delta, goodDirection }: { delta: KpiDelta; goodDirection: 'up' | 'down' }) {
    if (delta.suppressedReason) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn(text.subtle, 'cursor-help')}>—</span>
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

    // The sign is written out as well as drawn, so the direction survives for
    // anyone who cannot resolve the icon or the colour.
    const signed = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${delta.unit === 'points' ? 'pt' : '%'}`;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums cursor-help',
                        isGood ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                        isBad  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' :
                                 'bg-muted text-muted-foreground',
                    )}
                >
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {signed}
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
    loading = false,
    className,
}) => {
    const missing = value === null || value === undefined;
    const shown = missing ? '—' : value;

    const accessibleLabel = [
        label,
        missing ? 'no data' : shown,
        denominator,
        STATUS_WORD[status],
        delta && !delta.suppressedReason
            ? `${delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'unchanged'} ${delta.label}`
            : null,
    ].filter(Boolean).join(', ');

    const body = (
        <div
            className={cn(
                'relative h-full overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5',
                'transition-colors',
                href && 'hover:border-primary/40 focus-visible:border-primary/40',
                className,
            )}
        >
            {/* Severity stripe — carries status without relying on colour of text alone */}
            <span
                aria-hidden="true"
                className={cn('absolute inset-y-0 left-0 w-[3px]', STATUS_STRIPE[status])}
            />

            <div className="flex items-start justify-between gap-2">
                {tooltip ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className={cn(text.overline, 'cursor-help truncate')}>{label}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px]">{tooltip}</TooltipContent>
                    </Tooltip>
                ) : (
                    <span className={cn(text.overline, 'truncate')}>{label}</span>
                )}
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </div>

            <div className="mt-2 flex items-baseline gap-2">
                {loading ? (
                    <Skeleton className="h-8 w-24" />
                ) : (
                    <>
                        <span
                            className={cn(
                                'text-[28px] font-bold leading-none tracking-tight tabular-nums',
                                missing ? 'text-muted-foreground' : STATUS_VALUE[status],
                            )}
                        >
                            {shown}
                        </span>
                        {delta && <DeltaBadge delta={delta} goodDirection={deltaGoodDirection} />}
                    </>
                )}
            </div>

            {denominator && !loading && (
                <p className={cn(text.caption, 'mt-1.5 truncate')}>{denominator}</p>
            )}
        </div>
    );

    if (href) {
        return (
            <Link
                to={href}
                aria-label={accessibleLabel}
                className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                {body}
            </Link>
        );
    }

    return (
        <div role="group" aria-label={accessibleLabel}>
            {body}
        </div>
    );
};

export default KpiTile;
