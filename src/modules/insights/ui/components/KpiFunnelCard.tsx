/**
 * KpiFunnelCard — Sleek, multi-step pipeline funnel card matching the reference UI.
 *
 * Visualizes progressive stage drop-offs (e.g. Swaps: Initiated → Offers Received → Peer Accepted → Approved → Completed)
 * with connected stepped gradient shapes, step metrics, and a bottom diagnostics strip.
 */

import React from 'react';
import { ArrowRight, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';

export interface FunnelStep {
    id: string;
    stepNumber: number;
    title: string;
    value: number | string;
    conversionRate: number; // e.g. 100, 72.2, 45.8%
    dropOffCount?: number;
    color?: string;
}

export interface KpiFunnelCardProps {
    title: string;
    badgeText?: string;
    subtitle?: string;
    steps: FunnelStep[];
    overallRate: string;
    totalDropOffs: number | string;
    biggestDropOff?: {
        fromStep: string;
        toStep: string;
        count: number | string;
    };
    opportunityText?: string;
    onViewInsights?: () => void;
    onViewDetails?: () => void;
    className?: string;
}

export const KpiFunnelCard: React.FC<KpiFunnelCardProps> = ({
    title,
    badgeText = 'Primary Pipeline',
    subtitle,
    steps,
    overallRate,
    totalDropOffs,
    biggestDropOff,
    opportunityText,
    onViewInsights,
    onViewDetails,
    className,
}) => {
    return (
        <div className={cn('flex flex-col rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm', className)}>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-border/40">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h3 className="text-lg font-bold tracking-tight text-foreground">{title}</h3>
                        {badgeText && (
                            <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/15 font-semibold text-xs border-0">
                                {badgeText}
                            </Badge>
                        )}
                    </div>
                    {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
                </div>
                {onViewDetails && (
                    <Button variant="outline" size="sm" onClick={onViewDetails} className="h-8 text-xs font-semibold rounded-lg">
                        View Pipeline
                    </Button>
                )}
            </div>

            {/* Steps & Stepped Funnel Visualization */}
            <div className="py-6 overflow-x-auto">
                <div className="min-w-[600px]">
                    {/* Step Metrics Row */}
                    <div className="grid grid-cols-5 gap-2 mb-4">
                        {steps.map((s, idx) => (
                            <div key={s.id} className="flex flex-col">
                                <p className="text-xs font-semibold text-muted-foreground truncate">
                                    {s.stepNumber}. {s.title}
                                </p>
                                <p className="text-2xl font-bold tracking-tight text-foreground mt-1 tabular-nums">
                                    {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                                </p>
                                <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                    {s.conversionRate}%
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Stepped Visual Graphic */}
                    <div className="relative h-28 w-full flex items-end gap-1.5 rounded-xl p-2 bg-muted/20 border border-border/30">
                        {steps.map((s, idx) => {
                            const heightPercent = Math.max(15, Math.min(100, s.conversionRate));
                            // Color gradation across steps: Blue -> Cyan -> Teal -> Emerald
                            const colors = [
                                'from-blue-600/70 to-blue-500/40 border-blue-500/60',
                                'from-sky-500/70 to-sky-400/40 border-sky-400/60',
                                'from-teal-500/70 to-teal-400/40 border-teal-400/60',
                                'from-emerald-500/70 to-emerald-400/40 border-emerald-400/60',
                                'from-purple-500/70 to-purple-400/40 border-purple-400/60',
                            ];
                            const colorClass = colors[idx % colors.length];

                            return (
                                <div key={s.id} className="flex-1 flex flex-col justify-end h-full relative group">
                                    <div
                                        style={{ height: `${heightPercent}%` }}
                                        className={cn(
                                            'w-full rounded-t-lg bg-gradient-to-t border-t border-x transition-all duration-300 group-hover:opacity-90',
                                            colorClass,
                                        )}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Summary Strip */}
            <div className="mt-auto pt-4 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
                <div>
                    <p className="text-[11px] font-semibold text-muted-foreground">Overall Completion Rate</p>
                    <p className="text-xl font-bold text-primary tabular-nums mt-0.5">{overallRate}</p>
                </div>

                <div>
                    <p className="text-[11px] font-semibold text-muted-foreground">Total Drop-offs</p>
                    <p className="text-xl font-bold text-foreground tabular-nums mt-0.5">
                        {typeof totalDropOffs === 'number' ? totalDropOffs.toLocaleString() : totalDropOffs}
                    </p>
                </div>

                {biggestDropOff && (
                    <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">Largest Drop-off</p>
                        <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mt-0.5 truncate">
                            {biggestDropOff.fromStep} → {biggestDropOff.toStep} ({biggestDropOff.count})
                        </p>
                    </div>
                )}

                {opportunityText && (
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-muted-foreground">Improvement Point</p>
                            <p className="text-xs font-medium text-foreground truncate mt-0.5">{opportunityText}</p>
                        </div>
                        {onViewInsights && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={onViewInsights}
                                className="h-7 px-2.5 text-xs font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 shrink-0"
                            >
                                <Sparkles className="h-3 w-3 mr-1" />
                                Insights
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default KpiFunnelCard;
