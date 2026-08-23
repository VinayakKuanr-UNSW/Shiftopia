/**
 * KpiFunctionBar — row 3 of the GoldStandardHeader on the KPI page.
 *
 * Renamed from InsightsFunctionBar and reduced to one period control. The old
 * bar swapped between a date-range preset and a quarter picker depending on
 * the active tab, which is how the page came to show two different periods at
 * once. There is one period now, and it is a quarter.
 */

import React from 'react';
import { RefreshCw, GitCompareArrows } from 'lucide-react';
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
    const comparisonLabel =
        quarters.find((q) => q.label === period.label) === quarters[quarters.length - 1]
            ? null
            : 'previous quarter';

    return (
        <div className={cn('flex w-full flex-wrap items-center justify-between gap-3', className)}>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
                {/* Horizontally scrollable on a phone rather than wrapping into
                    a second row that pushes the content below the fold. */}
                <TabsList className="h-11 max-w-full justify-start overflow-x-auto rounded-xl border border-border bg-muted/50 p-1">
                    {tabs.map(({ value, label, Icon }) => (
                        <TabsTrigger
                            key={value}
                            value={value}
                            className={cn(
                                'gap-2 rounded-lg px-3 shrink-0',
                                text.label,
                                'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            <span>{label}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                <div className="flex items-center gap-2">
                    <label className={cn(text.overline, 'hidden sm:inline')} htmlFor="kpi-period">
                        Quarter
                    </label>
                    <Select value={period.label} onValueChange={onPeriodChange}>
                        <SelectTrigger id="kpi-period" className={cn('w-[132px] rounded-xl', touch.targetY)}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {quarters.map((q) => (
                                <SelectItem key={q.label} value={q.label}>{q.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className={cn(text.subtle, 'hidden tabular-nums lg:inline')}>
                        {period.startDate} → {period.endDate}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    variant={compare === 'previous' ? 'default' : 'outline'}
                    onClick={() => onCompareChange(compare === 'previous' ? 'none' : 'previous')}
                    className={cn('gap-2 rounded-xl', touch.targetY)}
                    aria-pressed={compare === 'previous'}
                    title={comparisonLabel ? `Compare with the ${comparisonLabel}` : undefined}
                >
                    <GitCompareArrows className="h-4 w-4" />
                    <span className="hidden sm:inline">Compare</span>
                </Button>
                <Button
                    variant="outline"
                    onClick={onRefresh}
                    className={cn('gap-2 rounded-xl', touch.targetY)}
                >
                    <RefreshCw className="h-4 w-4" />
                    <span className="hidden sm:inline">Refresh</span>
                </Button>
            </div>
        </div>
    );
};

export default KpiFunctionBar;
