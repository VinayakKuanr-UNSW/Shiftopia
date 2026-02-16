import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { usePerformanceMetrics } from '@/modules/users/hooks/usePerformanceMetrics';
import { useEmployeeSkills } from '@/modules/users/hooks/useEmployeeSkills';
import { useEmployeeLicenses } from '@/modules/users/hooks/useEmployeeLicenses';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';

interface RiskAlertsSectionProps {
    employeeId: string;
    quarterYear: string;
}

const RiskAlertsSection: React.FC<RiskAlertsSectionProps> = ({ employeeId, quarterYear }) => {
    const { data: metrics } = usePerformanceMetrics(employeeId, quarterYear);
    const { data: skills } = useEmployeeSkills(employeeId);
    const { data: licenses } = useEmployeeLicenses(employeeId);

    // Calculate risk indicators
    const riskIndicators: Array<{ type: 'success' | 'warning'; message: string }> = [];

    if (metrics) {
        // Positive indicators
        if (metrics.no_shows === 0) {
            riskIndicators.push({ type: 'success', message: 'No No-Shows' });
        }
        if (metrics.cancellation_rate_late < 5) {
            riskIndicators.push({ type: 'success', message: 'Low Late Cancellation Rate' });
        }
        if (metrics.punctuality_rate >= 95) {
            riskIndicators.push({ type: 'success', message: 'Excellent Punctuality' });
        }

        // Warning indicators
        if (metrics.cancellation_rate_standard > 10) {
            riskIndicators.push({ type: 'warning', message: 'High Cancellation Rate' });
        }
        if (metrics.punctuality_rate < 90) {
            riskIndicators.push({ type: 'warning', message: 'Low Punctuality' });
        }
        if (metrics.no_shows > 2) {
            riskIndicators.push({ type: 'warning', message: `${metrics.no_shows} No-Shows` });
        }
    }

    // Check for expired licenses
    const expiredLicenses = licenses?.filter(l => l.status === 'Expired') || [];
    if (expiredLicenses.length > 0) {
        riskIndicators.push({
            type: 'warning',
            message: `${expiredLicenses.length} Expired License${expiredLicenses.length > 1 ? 's' : ''}`
        });
    }

    // Check for expired skills
    const expiredSkills = skills?.filter(s => {
        if (!s.expiration_date) return false;
        return differenceInDays(parseISO(s.expiration_date), new Date()) < 0;
    }) || [];
    if (expiredSkills.length > 0) {
        riskIndicators.push({
            type: 'warning',
            message: `${expiredSkills.length} Expired Skill${expiredSkills.length > 1 ? 's' : ''}`
        });
    }

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Risk & Alerts
                </CardTitle>
            </CardHeader>
            <CardContent>
                {riskIndicators.length === 0 ? (
                    <div className="text-center py-6">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-600 dark:text-green-400" />
                        <p className="text-sm text-muted-foreground">All metrics within normal range</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {riskIndicators.map((indicator, idx) => (
                            <Badge
                                key={idx}
                                className={
                                    indicator.type === 'success'
                                        ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/30 w-full justify-start py-2'
                                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30 w-full justify-start py-2'
                                }
                            >
                                {indicator.type === 'success' ? (
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                ) : (
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                )}
                                {indicator.message}
                            </Badge>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default RiskAlertsSection;
