/**
 * KpiHorizontalBars — Horizontal distribution / breakdown progress bars matching the reference UI.
 *
 * Clean progress bars with gradient fills, labels, percentages, and an optional footer note.
 */

import React from 'react';
import { cn } from '@/modules/core/lib/utils';

export interface HorizontalBarItem {
    id: string;
    label: string;
    value: number; // percentage (0 - 100) or count
    displayValue?: string; // e.g. "34.6%"
    color?: string;
}

interface KpiHorizontalBarsProps {
    title: string;
    subtitle?: string;
    items: HorizontalBarItem[];
    footerNote?: string;
    className?: string;
}

const BAR_GRADIENTS = [
    'from-indigo-600 to-indigo-400',
    'from-sky-500 to-sky-400',
    'from-teal-500 to-teal-400',
    'from-cyan-500 to-cyan-400',
    'from-purple-500 to-purple-400',
    'from-amber-500 to-amber-400',
];

export const KpiHorizontalBars: React.FC<KpiHorizontalBarsProps> = ({
    title,
    subtitle,
    items,
    footerNote,
    className,
}) => {
    const maxValue = Math.max(...items.map((i) => i.value), 100);

    return (
        <div className={cn('flex flex-col justify-between rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm', className)}>
            <div>
                <div className="pb-4 border-b border-border/40">
                    <h3 className="text-base font-bold text-foreground tracking-tight">{title}</h3>
                    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
                </div>

                <div className="py-4 space-y-3.5">
                    {items.map((item, idx) => {
                        const widthPct = Math.min(100, Math.max(5, (item.value / maxValue) * 100));
                        const gradient = item.color || BAR_GRADIENTS[idx % BAR_GRADIENTS.length];

                        return (
                            <div key={item.id} className="space-y-1.5 group">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[70%]">
                                        {item.label}
                                    </span>
                                    <span className="font-semibold tabular-nums text-muted-foreground">
                                        {item.displayValue || `${item.value}%`}
                                    </span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                                    <div
                                        style={{ width: `${widthPct}%` }}
                                        className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', gradient)}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {footerNote && (
                <p className="text-[11px] text-muted-foreground pt-3 border-t border-border/40">
                    {footerNote}
                </p>
            )}
        </div>
    );
};

export default KpiHorizontalBars;
