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
import { RefreshCw, Calendar } from 'lucide-react';
import { ToolbarRow, ToolbarIconButton, toolbar } from '@/modules/core/ui/components/Toolbar';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
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
        <ToolbarRow
            className={className}
            views={
                // Real tabs (each owns a TabsContent panel), styled as the shared views toggle.
                <TabsList className={cn(toolbar.segmented, 'max-w-full justify-start overflow-x-auto gap-0.5 text-inherit')}>
                    {tabs.map(({ value, label, Icon }) => (
                        <TabsTrigger
                            key={value}
                            value={value}
                            aria-label={label}
                            className={cn(
                                toolbar.segment,
                                'inline-flex items-center gap-2 shrink-0',
                                'data-[state=active]:bg-white dark:data-[state=active]:bg-white/10 data-[state=active]:text-slate-900 dark:data-[state=active]:text-foreground data-[state=active]:shadow-sm',
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{label}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>
            }
            modes={
                <div className="flex items-center gap-2">
                    <Select value={period.label} onValueChange={onPeriodChange}>
                        <SelectTrigger id="kpi-period" aria-label="Quarter" className={cn(toolbar.field, 'w-[140px] justify-between')}>
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {quarters.map((q) => (
                                <SelectItem key={q.label} value={q.label} className="text-[11px] font-medium">
                                    {q.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <span className={cn(text.caption, 'hidden tabular-nums xl:inline')}>
                        {period.startDate} → {period.endDate}
                    </span>
                </div>
            }
            actions={<>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span className="hidden sm:inline">Compare</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isComparing}
                        aria-label="Compare with the previous quarter"
                        onClick={() => onCompareChange(isComparing ? 'none' : 'previous')}
                        title={comparisonLabel ? `Compare with ${comparisonLabel}` : 'Compare periods'}
                        className={cn(
                            // The switch keeps its 24px track; the 44px target is the row around it.
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

                <ToolbarIconButton icon={<RefreshCw />} tooltip="Refresh data" onClick={onRefresh} variant="blue" />
            </>}
        />
    );
};

