import React from "react";
import { TrendingUp, Target } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

const ForecastingPlanningView: React.FC = () => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-purple-500/20 border border-purple-500/30">
                    <TrendingUp size={24} className="text-purple-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Forecasting & Planning</h2>
                    <p className="text-white/60 text-sm">Predictive analysis for future staffing needs</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Predicted Demand"
                    metric="+15%"
                    description="Expected increase next week"
                    icon={<Target size={18} className="text-purple-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Staff Availability"
                    metric="92%"
                    description="Projected availability for next period"
                    icon={<TrendingUp size={18} className="text-blue-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Roster Optimization"
                    metric="94%"
                    description="Efficiency score"
                    icon={<TrendingUp size={18} className="text-green-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Potential Shortfalls"
                    metric="2"
                    description="Predicted gaps in schedule"
                    icon={<TrendingUp size={18} className="text-rose-400" />}
                />
            </div>
        </section>
    );
};

export default ForecastingPlanningView;
