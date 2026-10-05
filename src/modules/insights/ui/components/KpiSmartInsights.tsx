/**
 * KpiSmartInsights — AI-style operational insights card matching the reference dashboard.
 *
 * Soft lavender/indigo background, rounded card, bullet insight items with icon boxes,
 * actionable takeaways, and interactive drill-down links.
 */

import React from 'react';
import { Sparkles, AlertTriangle, TrendingUp, Award, ArrowRight, Lightbulb, type LucideIcon } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { Link } from 'react-router-dom';

export interface InsightItem {
    id: string;
    type: 'alert' | 'opportunity' | 'highlight' | 'info';
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
    onAction?: () => void;
}

interface KpiSmartInsightsProps {
    title?: string;
    badgeLabel?: string;
    insights: InsightItem[];
    className?: string;
}

const TYPE_CONFIG: Record<InsightItem['type'], { icon: LucideIcon; iconColor: string; iconBg: string }> = {
    alert: {
        icon: AlertTriangle,
        iconColor: 'text-amber-600 dark:text-amber-400',
        iconBg: 'bg-amber-500/10 border-amber-500/20',
    },
    opportunity: {
        icon: TrendingUp,
        iconColor: 'text-teal-600 dark:text-teal-400',
        iconBg: 'bg-teal-500/10 border-teal-500/20',
    },
    highlight: {
        icon: Award,
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        iconBg: 'bg-indigo-500/10 border-indigo-500/20',
    },
    info: {
        icon: Lightbulb,
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-500/10 border-blue-500/20',
    },
};

export const KpiSmartInsights: React.FC<KpiSmartInsightsProps> = ({
    title = 'Operational Insights',
    badgeLabel = 'AI',
    insights,
    className,
}) => {
    return (
        <div
            className={cn(
                'flex flex-col justify-between rounded-2xl border border-indigo-200/50 dark:border-indigo-900/40',
                'bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-card dark:from-indigo-950/20 dark:via-purple-950/10 dark:to-card',
                'p-5 sm:p-6 shadow-sm',
                className,
            )}
        >
            {/* Header */}
            <div className="flex items-center gap-2 pb-4 border-b border-indigo-100 dark:border-indigo-900/30">
                <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="h-4 w-4" />
                </div>
                <h3 className="text-base font-bold text-foreground tracking-tight">{title}</h3>
                {badgeLabel && (
                    <Badge className="bg-indigo-600/15 text-indigo-600 dark:text-indigo-300 font-semibold text-[11px] px-1.5 py-0 border-0">
                        {badgeLabel}
                    </Badge>
                )}
            </div>

            {/* Insights list */}
            <div className="divide-y divide-indigo-100/60 dark:divide-indigo-900/20 py-2">
                {insights.map((item) => {
                    const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.info;
                    const Icon = config.icon;

                    return (
                        <div key={item.id} className="py-3.5 first:pt-2 last:pb-2 flex items-start gap-3.5 group">
                            <div className={cn('p-2 rounded-xl border shrink-0 mt-0.5', config.iconBg)}>
                                <Icon className={cn('h-4 w-4', config.iconColor)} />
                            </div>

                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-foreground">{item.title}</p>
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>

                                {(item.actionHref || item.onAction) && (
                                    <div className="mt-1.5">
                                        {item.actionHref ? (
                                            <Link
                                                to={item.actionHref}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                            >
                                                <span>{item.actionLabel || 'View insight'}</span>
                                                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={item.onAction}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                            >
                                                <span>{item.actionLabel || 'View insight'}</span>
                                                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default KpiSmartInsights;
