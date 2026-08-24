/**
 * KpiFunctionBar — row 3 of the GoldStandardHeader on the KPI page.
 *
 * Implements the minimal, consistent analytics control bar matching the reference dashboard:
 *  - Modern pill tab navigation with smooth active highlight
 *  - Clean Quarter dropdown trigger
 *  - Compare switch toggle matching the reference UI
 *  - Refresh action
 */

import React from 'react';
import { RefreshCw, GitCompareArrows, Calendar, Sparkles } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import type { CompareMode, QuarterRef } from '../../hooks/useKpiFilters';

export interface KpiTabDef {
    value: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
}

interface KpiFunctionBarProps {
    tabs: KpiTabDef[];
    period: QuarterRef;
    quarters: QuarterRef[];
    onPeriodChange: (label: string) => void;
    compare: CompareMode;
    onCompareChange: (mode: CompareMode) => void;
    onRefresh: () => void;
    className?: string;
}

export const KpiFunctionBar: React.FC<KpiFunctionBarProps> = ({
    tabs,
    period,
    quarters,
    onPeriodChange,
    compare,
    onCompareChange,
    onRefresh,
    className,
}) => {
    const isComparing = compare === 'previous';
    const comparisonLabel =
        quarters.find((q) => q.label === period.label) === quarters[quarters.length - 1]
            ? null
            : 'previous quarter';

    return (
        <div className={cn('flex w-full flex-wrap items-center justify-between gap-3', className)}>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
                {/* Modern Pill Tabs */}
                <TabsList className="h-10 max-w-full justify-start overflow-x-auto rounded-xl border border-border/70 bg-muted/40 p-1">
                    {tabs.map(({ value, label, Icon }) => (
                        <TabsTrigger
                            key={value}
                            value={value}
                            className={cn(
                                'gap-2 rounded-lg px-3.5 h-8 shrink-0 text-xs font-semibold transition-all',
                                'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
                                'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            <span>{label}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                {/* Period Selector */}
                <div className="flex items-center gap-2">
                    <Select value={period.label} onValueChange={onPeriodChange}>
                        <SelectTrigger
                            id="kpi-period"
                            className={cn(
                                'h-10 w-[140px] rounded-xl text-xs font-semibold border-border/70 bg-card hover:bg-muted/30 transition-colors',
                                touch.targetY,
                            )}
                        >
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {quarters.map((q) => (
                                <SelectItem key={q.label} value={q.label} className="text-xs font-medium">
                                    {q.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <span className={cn(text.caption, 'hidden tabular-nums xl:inline')}>
                        {period.startDate} → {period.endDate}
                    </span>
                </div>
            </div>

            {/* Right Controls: Compare Toggle + Refresh Button */}
            <div className="flex items-center gap-3">
                {/* Compare Toggle Pill matching reference image */}
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Compare</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isComparing}
                        onClick={() => onCompareChange(isComparing ? 'none' : 'previous')}
                        title={comparisonLabel ? `Compare with ${comparisonLabel}` : 'Compare periods'}
                        className={cn(
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            isComparing ? 'bg-primary' : 'bg-muted/80 dark:bg-muted/40',
                        )}
                    >
                        <span
                            className={cn(
                                'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out',
                                isComparing ? 'translate-x-5' : 'translate-x-0',
                            )}
                        />
                    </button>
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={onRefresh}
                    className={cn('h-10 px-3 gap-1.5 rounded-xl border-border/70 text-xs font-semibold bg-card hover:bg-muted/30', touch.targetY)}
                    title="Refresh data"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Refresh</span>
                </Button>
            </div>
        </div>
    );
};

export default KpiFunctionBar;
