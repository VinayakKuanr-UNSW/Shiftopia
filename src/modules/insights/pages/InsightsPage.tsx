import React from 'react';
import { Separator } from '@/modules/core/ui/primitives/separator';
import WorkforceUtilizationView from '../ui/views/WorkforceUtilizationView';
import EventLevelMetricsView from '../ui/views/EventLevelMetricsView';
import TimeAttendanceView from '../ui/views/TimeAttendanceView';
import EmployeeBehaviorView from '../ui/views/EmployeeBehaviorView';
import SchedulingEfficiencyView from '../ui/views/SchedulingEfficiencyView';
import CommunicationInteractionView from '../ui/views/CommunicationInteractionView';
import FinancialBudgetView from '../ui/views/FinancialBudgetView';
import ForecastingPlanningView from '../ui/views/ForecastingPlanningView';
import LocationBasedView from '../ui/views/LocationBasedView';
import ChartsView from '../ui/views/ChartsView';
import DepartmentSpecificView from '../ui/views/DepartmentSpecificView';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

const InsightsPage: React.FC = () => {
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-muted/20">
            <main className="flex-1 p-4 md:p-8 space-y-8">
                {/* Header Section */}
                <div className="glass-panel p-8 mb-8 border border-white/10 rounded-2xl backdrop-blur-xl bg-white/5">
                    <div className="max-w-4xl">
                        <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                            Insights & Analytics
                        </h1>
                        <p className="text-lg text-white/70 leading-relaxed">
                            Comprehensive performance metrics and operational statistics to drive informed decisions.
                        </p>
                    </div>
                </div>

                {/* Scope Filter */}
                <ScopeFilterBanner
                    mode="managerial"
                    onScopeChange={setScope}
                    hidden={isGammaLocked}
                />

                {/* Metrics Sections */}
                <div className="space-y-12">
                    <WorkforceUtilizationView scope={scope} />

                    <Separator className="bg-white/10" />

                    <EventLevelMetricsView scope={scope} />

                    <Separator className="bg-white/10" />

                    <TimeAttendanceView scope={scope} />

                    <Separator className="bg-white/10" />

                    <EmployeeBehaviorView scope={scope} />

                    <Separator className="bg-white/10" />

                    <SchedulingEfficiencyView scope={scope} />

                    <Separator className="bg-white/10" />

                    <CommunicationInteractionView />

                    <Separator className="bg-white/10" />

                    <FinancialBudgetView />

                    <Separator className="bg-white/10" />

                    <ForecastingPlanningView />

                    <Separator className="bg-white/10" />

                    <LocationBasedView />

                    <Separator className="bg-white/10" />

                    {/* Charts Section */}
                    <div className="space-y-6">
                        <h2 className="text-2xl font-bold text-white mb-6">Visual Analytics</h2>
                        <ChartsView />
                    </div>

                    <Separator className="bg-white/10" />

                    <DepartmentSpecificView />
                </div>
            </main>
        </div>
    );
};

export default InsightsPage;
