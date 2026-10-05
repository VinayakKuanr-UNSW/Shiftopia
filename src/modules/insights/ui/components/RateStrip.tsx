/**
 * RateStrip — a compact row of graded rates.
 *
 * The same composition AttendanceMetricsBar uses for one employee, driven by
 * the metric registry instead of a local threshold lookup, so the org view and
 * the personal scorecard grade identically.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { statusFor, formatMetric, labelFor, type MetricStatus } from '../../model/metric-registry';

const STATUS_TEXT: Record<MetricStatus, string> = {
    good:     'text-emerald-600 dark:text-emerald-400',
    warn:     'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-600 dark:text-rose-400',
    neutral:  'text-foreground',
};

const STATUS_WORD: Record<MetricStatus, string> = {
    good: 'on target', warn: 'needs attention', critical: 'off target', neutral: '',
};

export interface RateStripItem {
    metricId: string;
    value: number;
    /** Overrides the registry label when the surface needs a shorter word. */
    label?: string;
}

export const RateStrip: React.FC<{ items: RateStripItem[]; className?: string }> = ({
    items,
    className,
}) => (
    <dl
        className={cn(
            'grid grid-cols-2 gap-4 rounded-2xl border border-border bg-muted/30 p-4 sm:grid-cols-4 lg:grid-cols-8',
            className,
        )}
    >
        {items.map(({ metricId, value, label }) => {
            const status = statusFor(metricId, value);
            return (
                <div
                    key={metricId}
                    className="min-w-0 text-center"
                    // Status is in the label as a word, not just in the colour.
                    aria-label={`${label ?? labelFor(metricId)} ${formatMetric(metricId, value)} ${STATUS_WORD[status]}`.trim()}
                >
                    <dd className={cn('text-lg font-bold tabular-nums leading-none', STATUS_TEXT[status])}>
                        {formatMetric(metricId, value)}
                    </dd>
                    <dt className={cn(text.overline, 'mt-1.5 block truncate')}>
                        {label ?? labelFor(metricId)}
                    </dt>
                </div>
            );
        })}
    </dl>
);

export default RateStrip;
