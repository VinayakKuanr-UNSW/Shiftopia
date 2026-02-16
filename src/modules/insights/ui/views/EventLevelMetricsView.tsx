import React from "react";
import { ChartBar, Calendar, User, Clock } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";
import { useMetric } from "../../state/useMetric";

interface EventLevelMetricsViewProps {
    scope?: {
        org_ids: string[];
        dept_ids: string[];
        subdept_ids: string[];
    };
}

const EventLevelMetricsView: React.FC<EventLevelMetricsViewProps> = ({ scope }) => {
    const filters = {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        organizationId: scope?.org_ids[0],
        departmentId: scope?.dept_ids[0],
        subDepartmentId: scope?.subdept_ids[0],
    };

    const { data: demand, loading: loadingDemand } = useMetric("SHIFT_DEMAND", filters);
    const { data: supply, loading: loadingSupply } = useMetric("SHIFT_SUPPLY", filters);
    const { data: coverage, loading: loadingCoverage } = useMetric("ROLE_COVERAGE", filters);
    const { data: conflicts, loading: loadingConflicts } = useMetric("EVENT_CONFLICTS", filters);

    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <ChartBar size={24} className="text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Event-Level Metrics</h2>
                    <p className="text-white/60 text-sm">Real-time event staffing and coverage analysis</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_DEMAND"
                    title="Shift Demand vs. Supply"
                    metric={loadingDemand || loadingSupply ? "..." : `${demand?.value} / ${supply?.value}`}
                    description="Required vs. staff available"
                    icon={<Calendar size={18} className="text-cyan-400" />}
                    loading={loadingDemand || loadingSupply}
                />
                <InsightMetricCard
                    metricId="ROLE_COVERAGE"
                    title="Role Coverage"
                    metric={loadingCoverage ? "..." : `${coverage?.value}%`}
                    description="All critical roles filled"
                    icon={<User size={18} className="text-purple-300" />}
                    trend={coverage?.trend}
                    loading={loadingCoverage}
                />
                <InsightMetricCard
                    metricId="EVENT_CONFLICTS"
                    title="Conflict Analysis"
                    metric={loadingConflicts ? "..." : (conflicts?.value ? `${conflicts?.value} conflict` : "None")}
                    description="Overlapping event conflicts"
                    icon={<Clock size={18} className="text-orange-300" />}
                    trend={conflicts?.trend}
                    loading={loadingConflicts}
                />
            </div>
        </section>
    );
};

export default EventLevelMetricsView;
