import React from "react";
import { DollarSign, PieChart } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";
import { useMetric } from "../../state/useMetric";

const FinancialBudgetView: React.FC = () => {
    const filters = {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
    };

    const { data: labourCost, loading: loadingCost } = useMetric("LABOUR_COST", filters);
    const { data: budgetAdherence, loading: loadingBudget } = useMetric("BUDGET_ADHERENCE", filters);

    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                    <DollarSign size={24} className="text-amber-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Financial & Budget Analysis</h2>
                    <p className="text-white/60 text-sm">Monitor labor costs and budget adherence</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <InsightMetricCard
                    metricId="LABOUR_COST"
                    title="Total Labour Cost"
                    metric={loadingCost ? "..." : `$${labourCost?.value.toLocaleString()}`}
                    description="Total cost for selected period"
                    icon={<DollarSign size={18} className="text-green-400" />}
                    trend={labourCost?.trend}
                    loading={loadingCost}
                />
                <InsightMetricCard
                    metricId="BUDGET_ADHERENCE"
                    title="Budget Adherence"
                    metric={loadingBudget ? "..." : `${budgetAdherence?.value}%`}
                    description="Actual vs. budgeted cost"
                    icon={<PieChart size={18} className="text-blue-400" />}
                    trend={budgetAdherence?.trend}
                    loading={loadingBudget}
                />
                <InsightMetricCard
                    metricId="LABOUR_COST" // Placeholder for projected
                    title="Projected Cost"
                    metric="$12,500"
                    description="Estimated based on roster"
                    icon={<DollarSign size={18} className="text-amber-400" />}
                />
            </div>
        </section>
    );
};

export default FinancialBudgetView;
