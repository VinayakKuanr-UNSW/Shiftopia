/**
 * KpiPerformanceList — Compact ranked performance list with icons and trend sparklines.
 *
 * Matching the "Funnel Performance" side card in the reference UI.
 */

import React from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { Link } from 'react-router-dom';

export interface PerformanceListItem {
    id: string;
    label: string;
    value: string | number;
    icon?: LucideIcon;
    iconColor?: string;
    trend?: 'up' | 'down' | 'neutral';
    trendColor?: string;
    href?: string;
}

interface KpiPerformanceListProps {
    title: string;
    items: PerformanceListItem[];
    headerActionLabel?: string;
    onHeaderAction?: () => void;
    viewAllHref?: string;
    viewAllLabel?: string;
    className?: string;
}

function MiniTrendLine({ direction = 'up', color }: { direction?: 'up' | 'down' | 'neutral'; color?: string }) {
    const strokeColor = color || (direction === 'up' ? '#10b981' : direction === 'down' ? '#f43f5e' : '#64748b');
    const path = direction === 'up'
        ? "M 0 16 Q 10 18, 20 12 T 40 14 T 60 4"
        : direction === 'down'
        ? "M 0 4 Q 10 6, 20 12 T 40 10 T 60 16"
        : "M 0 10 Q 10 12, 20 8 T 40 11 T 60 10";

    return (
        <svg viewBox="0 0 60 20" className="w-12 h-5" aria-hidden="true">
            <path d={path} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export const KpiPerformanceList: React.FC<KpiPerformanceListProps> = ({
    title,
    items,
    headerActionLabel,
    onHeaderAction,
    viewAllHref,
    viewAllLabel = 'View all metrics →',
    className,
}) => {
    return (
        <div className={cn('flex flex-col justify-between rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm', className)}>
            <div>
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-border/40">
                    <h3 className="text-base font-bold text-foreground tracking-tight">{title}</h3>
                    {headerActionLabel && onHeaderAction && (
                        <Button variant="ghost" size="sm" onClick={onHeaderAction} className="h-7 text-xs font-semibold px-2">
                            {headerActionLabel}
                        </Button>
                    )}
                </div>

                {/* Table Header */}
                <div className="flex items-center justify-between py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <span>Dimension</span>
                    <div className="flex items-center gap-6">
                        <span>Rate</span>
                        <span className="w-12 text-right">Trend</span>
                    </div>
                </div>

                {/* List Items */}
                <div className="divide-y divide-border/30">
                    {items.map((item) => {
                        const Icon = item.icon;
                        const rowContent = (
                            <div className="flex items-center justify-between py-3 group hover:bg-muted/20 px-1 -mx-1 rounded-lg transition-colors">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {Icon && (
                                        <div className={cn('p-1.5 rounded-lg shrink-0 bg-primary/10 text-primary', item.iconColor)}>
                                            <Icon className="h-3.5 w-3.5" />
                                        </div>
                                    )}
                                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                        {item.label}
                                    </span>
                                </div>

                                <div className="flex items-center gap-6 shrink-0">
                                    <span className="text-xs font-bold tabular-nums text-foreground">
                                        {item.value}
                                    </span>
                                    <MiniTrendLine direction={item.trend} color={item.trendColor} />
                                </div>
                            </div>
                        );

                        if (item.href) {
                            return (
                                <Link key={item.id} to={item.href} className="block">
                                    {rowContent}
                                </Link>
                            );
                        }

                        return <div key={item.id}>{rowContent}</div>;
                    })}
                </div>
            </div>

            {viewAllHref && (
                <div className="pt-4 border-t border-border/40">
                    <Link
                        to={viewAllHref}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                        <span>{viewAllLabel}</span>
                    </Link>
                </div>
            )}
        </div>
    );
};

export default KpiPerformanceList;
