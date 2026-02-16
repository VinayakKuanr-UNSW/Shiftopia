import React from "react";
import { Building2 } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

const DepartmentSpecificView: React.FC = () => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <Building2 size={24} className="text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Department Specific Insights</h2>
                    <p className="text-white/60 text-sm">Deep dive into individual department performance</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Convention Hall"
                    metric="94%"
                    description="Operational efficiency"
                    icon={<Building2 size={18} className="text-blue-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Exhibition Center"
                    metric="88%"
                    description="Operational efficiency"
                    icon={<Building2 size={18} className="text-green-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Theatre District"
                    metric="92%"
                    description="Operational efficiency"
                    icon={<Building2 size={18} className="text-rose-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Main Pavilion"
                    metric="90%"
                    description="Operational efficiency"
                    icon={<Building2 size={18} className="text-purple-400" />}
                />
            </div>
        </section>
    );
};

export default DepartmentSpecificView;
