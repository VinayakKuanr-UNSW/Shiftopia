/**
 * KPI — the manager-facing dashboard (route stays /insights).
 *
 * Five tabs. The four behavioural ones are the failure modes of a shift
 * marketplace, and each maps onto a distinct terminal outcome that already
 * exists in the data:
 *
 *   Attendance     worked / no_show, and the punctuality flags
 *   Bids           the pre-assignment competition
 *   Swaps          traded_out, plus the offer funnel
 *   Cancellations  dropped_std / dropped_late
 *
 * Overview carries what belongs to none of them — coverage, cost, compliance
 * and the composite scores — rather than force-fitting them into a tab whose
 * question they do not answer.
 *
 * Only the active tab mounts. Radix renders every TabsContent child by
 * default, which previously fired all four tabs' queries on page load.
 */

import React, { useCallback } from 'react';
import { BarChart3, Activity, Gavel, ArrowLeftRight, CalendarX, LayoutGrid } from 'lucide-react';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useQueryClient } from '@tanstack/react-query';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';

import { useKpiFilters } from '../hooks/useKpiFilters';
import { KpiFunctionBar, type KpiTabDef } from '../ui/components/KpiFunctionBar';
import OverviewTab from '../ui/views/OverviewTab';
import PerformanceTab from '../ui/views/PerformanceTab';
import ComplianceCostTab from '../ui/views/ComplianceCostTab';
import BidsTab from '../ui/tabs/BidsTab';
import SwapsTab from '../ui/tabs/SwapsTab';
import AttendanceTab from '../ui/tabs/AttendanceTab';
import CancellationsTab from '../ui/tabs/CancellationsTab';
import ManagerScorecardBand from '../ui/tabs/ManagerScorecardBand';

const TABS: KpiTabDef[] = [
    { value: 'overview',      label: 'Overview',      Icon: LayoutGrid },
    { value: 'attendance',    label: 'Attendance',    Icon: Activity },
    { value: 'bids',          label: 'Bids',          Icon: Gavel },
    { value: 'swaps',         label: 'Swaps',         Icon: ArrowLeftRight },
    { value: 'cancellations', label: 'Cancellations', Icon: CalendarX },
];

/** Query keys each tab owns, so Refresh invalidates exactly what is on screen. */
const TAB_QUERY_KEYS: Record<string, string[]> = {
    overview:      ['insights_summary', 'insights_trend', 'insights_dept_breakdown', 'marketplace_kpis', 'manager_scorecard', 'quarterly_performance_report'],
    attendance:    ['quarterly_performance_report'],
    bids:          ['bidding_kpis', 'quarterly_performance_report'],
    swaps:         ['marketplace_kpis', 'quarterly_performance_report'],
    cancellations: ['quarterly_performance_report', 'cancellation_reasons'],
};

const InsightsPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const {
        filters, period, quarters, compare, activeTab,
        setPeriodByLabel, setCompare, setActiveTab,
    } = useKpiFilters(scope, 'overview');
    const queryClient = useQueryClient();
    const { isDark } = useTheme();

    /**
     * Refresh must invalidate every key the ACTIVE tab reads. It is also the
     * only invalidation path inside the Capacitor WebView: the global
     * refetchOnWindowFocus hangs off `visibilitychange`, which the WebView
     * never fires, so on a phone every staleTime is effectively infinite.
     */
    const handleRefresh = useCallback(() => {
        for (const key of TAB_QUERY_KEYS[activeTab] ?? []) {
            queryClient.invalidateQueries({ queryKey: [key] });
        }
    }, [activeTab, queryClient]);

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex h-full flex-col overflow-hidden bg-background">
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <GoldStandardHeader
                        title="KPI"
                        Icon={BarChart3}
                        mode="managerial"
                        scope={scope}
                        setScope={setScope}
                        isGammaLocked={isGammaLocked}
                        functionBar={
                            <KpiFunctionBar
                                tabs={TABS}
                                period={period}
                                quarters={quarters}
                                onPeriodChange={setPeriodByLabel}
                                compare={compare}
                                onCompareChange={setCompare}
                                onRefresh={handleRefresh}
                            />
                        }
                    />

                    <div
                        className={cn(
                            'custom-scrollbar mx-4 mb-4 min-h-0 flex-1 overflow-y-auto rounded-[32px] border p-4 transition-all lg:mx-6 lg:mb-6 lg:p-8',
                            isDark
                                ? 'border-white/5 bg-[#1c2333]/40 shadow-2xl shadow-black/20'
                                : 'border-white bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-md',
                        )}
                    >
                        <TabsContent value="overview" className="mt-0 outline-none">
                            {activeTab === 'overview' && (
                                <div className="flex flex-col gap-10">
                                    <OverviewTab filters={{
                                        startDate: period.startDate,
                                        endDate: period.endDate,
                                        orgIds: filters.orgIds,
                                        deptIds: filters.deptIds,
                                        subdeptIds: filters.subdeptIds,
                                    }} />
                                    <ComplianceCostTab filters={{
                                        startDate: period.startDate,
                                        endDate: period.endDate,
                                        orgIds: filters.orgIds,
                                        deptIds: filters.deptIds,
                                        subdeptIds: filters.subdeptIds,
                                    }} />
                                    <ManagerScorecardBand filters={filters} scope={scope} />
                                    <PerformanceTab
                                        scope={scope}
                                        selectedYear={period.year}
                                        selectedQuarter={period.quarter}
                                    />
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="attendance" className="mt-0 outline-none">
                            {activeTab === 'attendance' && <AttendanceTab filters={filters} scope={scope} />}
                        </TabsContent>

                        <TabsContent value="bids" className="mt-0 outline-none">
                            {activeTab === 'bids' && <BidsTab filters={filters} scope={scope} />}
                        </TabsContent>

                        <TabsContent value="swaps" className="mt-0 outline-none">
                            {activeTab === 'swaps' && <SwapsTab filters={filters} scope={scope} />}
                        </TabsContent>

                        <TabsContent value="cancellations" className="mt-0 outline-none">
                            {activeTab === 'cancellations' && <CancellationsTab filters={filters} scope={scope} />}
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </TooltipProvider>
    );
};

export default InsightsPage;
