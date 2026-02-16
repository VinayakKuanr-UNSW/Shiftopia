import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { usePerformanceMetrics, useMetricComparison } from '@/modules/users/hooks/usePerformanceMetrics';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface PerformanceSectionProps {
    employeeId: string;
    quarterYear: string;
}

const PerformanceSection: React.FC<PerformanceSectionProps> = ({ employeeId, quarterYear }) => {
    const { data: fetchedMetrics, isLoading } = usePerformanceMetrics(employeeId, quarterYear);

    const metrics = fetchedMetrics || {
        id: 'default',
        acceptance_rate: 0,
        punctuality_rate: 0,
        rejection_rate: 0,
        swap_ratio: 0,
        cancellation_rate_standard: 0,
        cancellation_rate_late: 0,
        no_shows: 0,
        shifts_assigned: 0,
        shifts_worked: 0,
        standard_cancellations: 0,
        late_cancellations: 0
    };

    const MetricCard = ({
        label,
        value,
        metricType
    }: {
        label: string;
        value: number;
        metricType: string;
    }) => {
        const comparison = useMetricComparison(value, metricType);
        const isAbove = comparison === 'above';

        return (
            <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">{label}</p>
                <div className="flex items-end justify-between">
                    <p className="text-3xl font-bold text-foreground">
                        {value.toFixed(metricType.includes('rate') || metricType.includes('ratio') ? 1 : 0)}
                        {metricType.includes('rate') || metricType.includes('ratio') ? '%' : ''}
                    </p>
                    <div className={`flex items-center gap-1 text-xs ${isAbove ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {isAbove ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        <span>{isAbove ? 'Above' : 'Below'} Avg</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Performance
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-muted-foreground text-sm">Loading performance metrics...</p>
                ) : (
                    <div className="space-y-4">
                        {/* Core Metrics */}
                        <div>
                            <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase">Core Performance</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <MetricCard label="Acceptance" value={metrics.acceptance_rate} metricType="acceptance_rate" />
                                <MetricCard label="Punctuality" value={metrics.punctuality_rate} metricType="punctuality_rate" />
                                <MetricCard label="Rejection" value={metrics.rejection_rate} metricType="rejection_rate" />
                                <MetricCard label="Swap Ratio" value={metrics.swap_ratio} metricType="swap_ratio" />
                            </div>
                        </div>

                        {/* Cancellation Metrics */}
                        <div>
                            <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase">Cancellation & Reliability</h4>
                            <div className="grid grid-cols-3 gap-3">
                                <MetricCard
                                    label="Standard Cancel"
                                    value={metrics.cancellation_rate_standard}
                                    metricType="cancellation_rate_standard"
                                />
                                <MetricCard
                                    label="Late Cancel"
                                    value={metrics.cancellation_rate_late}
                                    metricType="cancellation_rate_late"
                                />
                                <MetricCard
                                    label="No-Shows"
                                    value={metrics.no_shows}
                                    metricType="no_shows"
                                />
                            </div>
                        </div>

                        {/* Raw Counts */}
                        <div className="bg-muted/50 dark:bg-card/50 p-3 rounded-lg border border-border">
                            <div className="grid grid-cols-3 gap-4 text-xs">
                                <div>
                                    <p className="text-muted-foreground">Shifts Assigned</p>
                                    <p className="text-foreground font-medium">{metrics.shifts_assigned}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Shifts Worked</p>
                                    <p className="text-foreground font-medium">{metrics.shifts_worked}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Total Cancellations</p>
                                    <p className="text-foreground font-medium">
                                        {metrics.standard_cancellations + metrics.late_cancellations + metrics.no_shows}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default PerformanceSection;
