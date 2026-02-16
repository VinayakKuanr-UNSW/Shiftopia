import React from "react";
import { Clock } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

interface InsightsViewProps {
    scope?: {
        org_ids: string[];
        dept_ids: string[];
        subdept_ids: string[];
    };
}

const TimeAttendanceView: React.FC<InsightsViewProps> = ({ scope }) => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30">
                    <Clock size={24} className="text-indigo-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Time & Attendance</h2>
                    <p className="text-white/60 text-sm">Track clock-in/out accuracy and total hours</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Avg. Clock-in Offset"
                    metric="2 min"
                    description="Average delay from rostered start"
                    icon={<Clock size={18} className="text-indigo-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Missed Clock-outs"
                    metric="3"
                    description="Total in last 7 days"
                    icon={<Clock size={18} className="text-rose-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Manual Adjustments"
                    metric="12"
                    description="Timesheet edits needed"
                    icon={<Clock size={18} className="text-orange-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Overtime Hours"
                    metric="24.5h"
                    description="Total hours above rostered"
                    icon={<Clock size={18} className="text-yellow-400" />}
                />
            </div>
        </section>
    );
};

export default TimeAttendanceView;
