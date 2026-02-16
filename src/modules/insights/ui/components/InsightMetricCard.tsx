import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MetricId } from "../../model/metric.types";

interface InsightMetricCardProps {
    metricId: MetricId;
    title: string;
    metric: string | number;
    description: string;
    icon: React.ReactNode;
    trend?: "up" | "down" | "stable";
    loading?: boolean;
}

const InsightMetricCard: React.FC<InsightMetricCardProps> = ({
    title,
    metric,
    description,
    icon,
    trend,
    loading
}) => {
    return (
        <Card className="bg-white/5 border-white/10 hover:bg-white/10 transition-all duration-300 group">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-white/70 group-hover:text-white transition-colors">
                    {title}
                </CardTitle>
                <div className="p-2 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                    {icon}
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="h-8 w-24 bg-white/10 animate-pulse rounded mb-1" />
                ) : (
                    <div className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                        {metric}
                        {trend && (
                            <span className={`text-xs flex items-center ${trend === 'up' ? 'text-green-400' :
                                    trend === 'down' ? 'text-rose-400' :
                                        'text-white/40'
                                }`}>
                                {trend === 'up' && <TrendingUp size={14} />}
                                {trend === 'down' && <TrendingDown size={14} />}
                                {trend === 'stable' && <Minus size={14} />}
                            </span>
                        )}
                    </div>
                )}
                <p className="text-xs text-white/50">{description}</p>
            </CardContent>
        </Card>
    );
};

export default InsightMetricCard;
