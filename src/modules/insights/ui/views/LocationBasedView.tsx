import React from "react";
import { MapPin } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

const LocationBasedView: React.FC = () => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-teal-500/20 border border-teal-500/30">
                    <MapPin size={24} className="text-teal-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Location-Based Insights</h2>
                    <p className="text-white/60 text-sm">Geospatial analysis of staff movement and coverage</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Zone Coverage"
                    metric="96%"
                    description="Staff presence in assigned zones"
                    icon={<MapPin size={18} className="text-teal-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Avg. Travel Time"
                    metric="4 min"
                    description="Between assigned locations"
                    icon={<MapPin size={18} className="text-teal-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Location Conflicts"
                    metric="0"
                    description="Staff assigned to multiple sites"
                    icon={<MapPin size={18} className="text-teal-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Dense Zones"
                    metric="Exhibition Hall"
                    description="Highest staff density area"
                    icon={<MapPin size={18} className="text-teal-400" />}
                />
            </div>
        </section>
    );
};

export default LocationBasedView;
