import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface InsightMetricCardProps {
    metricId: string;
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
        <Card className="bg-card border-border hover:bg-accent/5 transition-all duration-300 group">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {title}
                </CardTitle>
                <div className="p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
                    {icon}
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="h-8 w-24 bg-muted animate-pulse rounded mb-1" />
                ) : (
                    <div className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                        {metric}
                        {trend && (
                            <span className={`text-xs flex items-center ${
                                trend === 'up'     ? 'text-emerald-500' :
                                trend === 'down'   ? 'text-rose-500' :
                                                     'text-muted-foreground'
                            }`}>
                                {trend === 'up'     && <TrendingUp  size={14} />}
                                {trend === 'down'   && <TrendingDown size={14} />}
                                {trend === 'stable' && <Minus        size={14} />}
                            </span>
                        )}
                    </div>
                )}
                <p className="text-xs text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
};

export default InsightMetricCard;
