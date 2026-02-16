import React from "react";
import { Brain, ChartBar, Clock, User } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";
import { useMetric } from "../../state/useMetric";

interface WorkforceUtilizationViewProps {
    scope?: {
        org_ids: string[];
        dept_ids: string[];
        subdept_ids: string[];
    };
}

const WorkforceUtilizationView: React.FC<WorkforceUtilizationViewProps> = ({ scope }) => {
    // Sync with scope from parent
    const filters = {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        organizationId: scope?.org_ids[0],
        departmentId: scope?.dept_ids[0],
        subDepartmentId: scope?.subdept_ids[0],
    };

    const { data: shiftFillRate, loading: loadingFill } = useMetric("SHIFT_FILL_RATE", filters);
    const { data: utilization, loading: loadingUtil } = useMetric("EMPLOYEE_UTILIZATION", filters);
    const { data: noShow, loading: loadingNoShow } = useMetric("NO_SHOW_RATE", filters);
    const { data: punctuality, loading: loadingPunct } = useMetric("PUNCTUALITY_RATE", filters);
    const { data: underutilized, loading: loadingUnder } = useMetric("UNDERUTILIZED_STAFF_COUNT", filters);

    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Brain size={24} className="text-blue-300" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Workforce Utilization & Productivity</h2>
                    <p className="text-white/60 text-sm">Monitor staff efficiency and attendance patterns</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE"
                    title="Shift Fill Rate"
                    metric={loadingFill ? "..." : `${shiftFillRate?.value}%`}
                    description="Percentage of planned shifts filled"
                    icon={<ChartBar size={18} className="text-green-400" />}
                    trend={shiftFillRate?.trend}
                    loading={loadingFill}
                />
                <InsightMetricCard
                    metricId="EMPLOYEE_UTILIZATION"
                    title="Employee Utilization"
                    metric={loadingUtil ? "..." : `${utilization?.value}%`}
                    description="Rostered vs. available hours"
                    icon={<User size={18} className="text-sky-400" />}
                    trend={utilization?.trend}
                    loading={loadingUtil}
                />
                <InsightMetricCard
                    metricId="NO_SHOW_RATE"
                    title="No-show Rate"
                    metric={loadingNoShow ? "..." : `${noShow?.value}%`}
                    description="Missed shifts/assignments"
                    icon={<Clock size={18} className="text-rose-400" />}
                    trend={noShow?.trend}
                    loading={loadingNoShow}
                />
                <InsightMetricCard
                    metricId="PUNCTUALITY_RATE"
                    title="Late Start / Early Finish"
                    metric={loadingPunct ? "..." : `${punctuality?.value} shifts`}
                    description="Recent irregularities"
                    icon={<Clock size={18} className="text-orange-400" />}
                    loading={loadingPunct}
                />
                <InsightMetricCard
                    metricId="UNDERUTILIZED_STAFF_COUNT"
                    title="Underutilized Staff"
                    metric={loadingUnder ? "..." : underutilized?.value || 0}
                    description="Staff consistently not rostered"
                    icon={<User size={18} className="text-yellow-400" />}
                    loading={loadingUnder}
                />
            </div>
        </section>
    );
};

export default WorkforceUtilizationView;
