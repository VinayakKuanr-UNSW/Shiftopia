import React from "react";
import { Zap } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

interface InsightsViewProps {
    scope?: {
        org_ids: string[];
        dept_ids: string[];
        subdept_ids: string[];
    };
}

const SchedulingEfficiencyView: React.FC<InsightsViewProps> = ({ scope }) => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-orange-500/20 border border-orange-500/30">
                    <Zap size={24} className="text-orange-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Scheduling Efficiency</h2>
                    <p className="text-white/60 text-sm">Measure the effectiveness of roster planning</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Avg. Shift Duration"
                    metric="7.5h"
                    description="Average length of assigned shifts"
                    icon={<Zap size={18} className="text-orange-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Last Minute Changes"
                    metric="14"
                    description="Roster edits within 24h of shift"
                    icon={<Zap size={18} className="text-yellow-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Compliance Score"
                    metric="100%"
                    description="Adherence to working hour rules"
                    icon={<Zap size={18} className="text-green-400" />}
                />
            </div>
        </section>
    );
};

export default SchedulingEfficiencyView;
