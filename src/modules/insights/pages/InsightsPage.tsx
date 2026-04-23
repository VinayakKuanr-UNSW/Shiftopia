import React, { useMemo } from 'react';
import { BarChart2, Users, ShieldCheck, RefreshCw } from 'lucide-react';
import {
    Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/modules/core/ui/primitives/tabs';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useQueryClient } from '@tanstack/react-query';
import { useDateRange, DATE_PRESET_LABELS } from '../hooks/useDateRange';
import type { DatePreset, InsightsFilters } from '../model/metric.types';
import OverviewTab from '../ui/views/OverviewTab';
import WorkforceTab from '../ui/views/WorkforceTab';
import ComplianceCostTab from '../ui/views/ComplianceCostTab';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
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
        <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-6">
            <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 space-y-6">
                {/* ── Unified Header Block (Rows 1-3) ────────────────────────────── */}
                <div className="flex-shrink-0">
                    <div className={cn(
                        "rounded-[32px] p-4 lg:p-6 transition-all border",
                        isDark 
                            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                    )}>
                        {/* Row 1 & 2: Identity & Scope Filter */}
                        <PersonalPageHeader
                            title="My Insights"
                            Icon={BarChart3}
                            scope={scope}
                            setScope={setScope}
                            isGammaLocked={isGammaLocked}
                            className="mb-4 lg:mb-6"
                        />

                        {/* Row 3: Module Function Bar (Integrated with Tabs) */}
                        <InsightsFunctionBar
                            preset={preset}
                            onPresetChange={v => setPreset(v as DatePreset)}
                            presetLabels={DATE_PRESET_LABELS}
                            presets={PRESETS}
                            startDate={startDate}
                            endDate={endDate}
                            onRefresh={handleRefresh}
                            className="mt-1"
                        />
                    </div>
                </div>

                {/* ── Main Content Area (Glassmorphic Container) ─────────────────── */}
                <div className={cn(
                    "flex-1 min-h-0 overflow-y-auto rounded-[32px] border transition-all p-4 lg:p-8 custom-scrollbar",
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
