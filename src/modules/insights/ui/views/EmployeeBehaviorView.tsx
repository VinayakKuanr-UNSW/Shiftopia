import React from "react";
import { User, Activity } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

interface InsightsViewProps {
    scope?: {
        org_ids: string[];
        dept_ids: string[];
        subdept_ids: string[];
    };
}

const EmployeeBehaviorView: React.FC<InsightsViewProps> = ({ scope }) => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-pink-500/20 border border-pink-500/30">
                    <User size={24} className="text-pink-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Employee Behavior & Engagement</h2>
                    <p className="text-white/60 text-sm">Analyze employee responsiveness and consistency</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Avg. Response Time"
                    metric="12 min"
                    description="To broadcast notifications"
                    icon={<Activity size={18} className="text-pink-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Swap Request Rate"
                    metric="8%"
                    description="Percentage of rostered shifts swapped"
                    icon={<Activity size={18} className="text-purple-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Bidding Active Users"
                    metric="85%"
                    description="Staff engaging with open bids"
                    icon={<Activity size={18} className="text-indigo-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Consistently Early"
                    metric="42"
                    description="Employees with >95% punctuality"
                    icon={<Activity size={18} className="text-green-400" />}
                />
            </div>
        </section>
    );
};

export default EmployeeBehaviorView;
