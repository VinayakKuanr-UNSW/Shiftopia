import React, { useMemo } from 'react';
import {
    Tabs, TabsContent,
} from '@/modules/core/ui/primitives/tabs';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useQueryClient } from '@tanstack/react-query';
import { useDateRange, DATE_PRESET_LABELS } from '../hooks/useDateRange';
import type { DatePreset, InsightsFilters } from '../model/metric.types';
import OverviewTab from '../ui/views/OverviewTab';
import WorkforceTab from '../ui/views/WorkforceTab';
import ComplianceCostTab from '../ui/views/ComplianceCostTab';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { InsightsFunctionBar } from '../ui/components/InsightsFunctionBar';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { BarChart3 } from 'lucide-react';

const PRESETS: DatePreset[] = ['THIS_WEEK', 'THIS_MONTH', 'LAST_30', 'LAST_90'];

const InsightsPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { preset, startDate, endDate, setPreset } = useDateRange('THIS_MONTH');
    const queryClient = useQueryClient();

    const filters: InsightsFilters = useMemo(() => ({
        startDate,
        endDate,
        orgIds:     scope.org_ids.length     ? scope.org_ids     : undefined,
        deptIds:    scope.dept_ids.length    ? scope.dept_ids    : undefined,
        subdeptIds: scope.subdept_ids.length ? scope.subdept_ids : undefined,
    }), [startDate, endDate, scope]);

    const { isDark } = useTheme();

    function handleRefresh() {
        queryClient.invalidateQueries({ queryKey: ['insights_summary'] });
        queryClient.invalidateQueries({ queryKey: ['insights_trend'] });
        queryClient.invalidateQueries({ queryKey: ['insights_dept_breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['quarterly_performance_report'] });
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
                {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
                <GoldStandardHeader
                    title="My Insights"
                    Icon={BarChart3}
                    mode="managerial"
                    scope={scope}
                    setScope={setScope}
                    isGammaLocked={isGammaLocked}
                    functionBar={
                        <InsightsFunctionBar
                            preset={preset}
                            onPresetChange={v => setPreset(v as DatePreset)}
                            presetLabels={DATE_PRESET_LABELS}
                            presets={PRESETS}
                            startDate={startDate}
                            endDate={endDate}
                            onRefresh={handleRefresh}
                        />
                    }
                />

                {/* ── BODY ── */}
                <div className={cn(
                    "flex-1 min-h-0 overflow-y-auto mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] border transition-all p-4 lg:p-8 custom-scrollbar",
                    isDark
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <TabsContent value="overview" className="mt-0 outline-none">
                        <OverviewTab filters={filters} />
                    </TabsContent>

                    <TabsContent value="workforce" className="mt-0 outline-none">
                        <WorkforceTab filters={filters} scope={scope} />
                    </TabsContent>

                    <TabsContent value="compliance" className="mt-0 outline-none">
                        <ComplianceCostTab filters={filters} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};

export default InsightsPage;
