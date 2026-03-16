import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { usePerformanceMetrics, EMPTY_METRICS } from '@/modules/users/hooks/usePerformanceMetrics';
import { useEmployeeSkills } from '@/modules/users/hooks/useEmployeeSkills';
import { useEmployeeLicenses } from '@/modules/users/hooks/useEmployeeLicenses';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';

interface RiskAlertsSectionProps {
    employeeId: string;
    quarterYear: string;
}

const RiskAlertsSection: React.FC<RiskAlertsSectionProps> = ({ employeeId, quarterYear }) => {
    const { data: fetchedMetrics } = usePerformanceMetrics(employeeId, quarterYear);
    const metrics = fetchedMetrics ? { ...EMPTY_METRICS, ...fetchedMetrics } : null;
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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-slate-500" />
                    Risk & Alerts
                </h3>
            </div>
            <div className="p-5 flex-1">
                {riskIndicators.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center text-slate-400">
                        <CheckCircle className="w-8 h-8 mx-auto mb-3 text-emerald-500/50" />
                        <p className="text-sm font-medium">All metrics within normal range</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {riskIndicators.map((indicator, idx) => (
                            <div
                                key={idx}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm font-medium ${indicator.type === 'success'
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20'
                                        : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/20'
                                    }`}
                            >
                                {indicator.type === 'success' ? (
                                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                ) : (
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                )}
                                <span>{indicator.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RiskAlertsSection;
