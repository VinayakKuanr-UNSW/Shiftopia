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

    function handleRefresh() {
        queryClient.invalidateQueries({ queryKey: ['insights_summary'] });
        queryClient.invalidateQueries({ queryKey: ['insights_trend'] });
        queryClient.invalidateQueries({ queryKey: ['insights_dept_breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['quarterly_performance_report'] });
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="p-4 md:p-8 space-y-6">
                {/* ── Page header ──────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">Insights & Analytics</h1>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Real-time workforce metrics derived from your live roster data
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2 self-start">
                        <RefreshCw size={14} />
                        Refresh
                    </Button>
                </div>

                {/* ── Scope filter ─────────────────────────────────── */}
                <ScopeFilterBanner
                    mode="managerial"
                    onScopeChange={setScope}
                    hidden={isGammaLocked}
                />

                {/* ── Date range selector ──────────────────────────── */}
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-muted-foreground shrink-0">Period:</span>
                    <Select value={preset} onValueChange={v => setPreset(v as DatePreset)}>
                        <SelectTrigger className="w-[160px] h-9 text-sm bg-card border-border">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PRESETS.map(p => (
                                <SelectItem key={p} value={p}>
                                    {DATE_PRESET_LABELS[p]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                        {startDate} → {endDate}
                    </span>
                </div>

                {/* ── Tabs ─────────────────────────────────────────── */}
                <Tabs defaultValue="overview" className="space-y-6">
                    <TabsList className="bg-muted/50 border border-border h-10 p-1 w-full sm:w-auto">
                        <TabsTrigger value="overview" className="gap-1.5 text-sm">
                            <BarChart2 size={14} />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="workforce" className="gap-1.5 text-sm">
                            <Users size={14} />
                            Workforce
                        </TabsTrigger>
                        <TabsTrigger value="compliance" className="gap-1.5 text-sm">
                            <ShieldCheck size={14} />
                            Compliance & Cost
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview">
                        <OverviewTab filters={filters} />
                    </TabsContent>

                    <TabsContent value="workforce">
                        <WorkforceTab filters={filters} scope={scope} />
                    </TabsContent>

                    <TabsContent value="compliance">
                        <ComplianceCostTab filters={filters} />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
};

export default InsightsPage;
