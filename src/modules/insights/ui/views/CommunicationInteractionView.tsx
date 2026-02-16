import React from "react";
import { MessageSquare } from "lucide-react";
import InsightMetricCard from "../components/InsightMetricCard";

const CommunicationInteractionView: React.FC = () => {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-pink-500/20 border border-pink-500/30">
                    <MessageSquare size={24} className="text-pink-400" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">Communication & Interaction</h2>
                    <p className="text-white/60 text-sm">Analyze effectiveness of platform communications</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Broadcast Read Rate"
                    metric="92%"
                    description="Staff reading critical notices"
                    icon={<MessageSquare size={18} className="text-pink-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Notification Clicks"
                    metric="4.2k"
                    description="Engagement with app notifications"
                    icon={<MessageSquare size={18} className="text-purple-400" />}
                />
                <InsightMetricCard
                    metricId="SHIFT_FILL_RATE" // Placeholder
                    title="Help Center Queries"
                    metric="15"
                    description="Support requests from staff"
                    icon={<MessageSquare size={18} className="text-indigo-400" />}
                />
            </div>
        </section>
    );
};

export default CommunicationInteractionView;
