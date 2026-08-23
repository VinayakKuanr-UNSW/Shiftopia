/**
 * Performance — the employee-facing half of the KPI split.
 *
 * Every access level reaches this page and sees their OWN numbers.
 * get_employee_quarterly_performance already carries the guard that makes that
 * safe: `p_employee_id = auth.uid() OR is_manager_or_above()`.
 *
 * The four sections mirror the manager KPI tabs, so the two pages describe the
 * same world in the same words — a person told their critical cancellation
 * rate is high finds the same metric, defined the same way and graded by the
 * same bands, on their manager's dashboard.
 *
 * This also replaces the Profile page's activity panels, which rendered twelve
 * hardcoded literals (offered: 40, accepted: 32, swapped: {2,1}, …). None of
 * those numbers came from the database.
 */

import React from 'react';
import { Activity, Gavel, ArrowLeftRight, CalendarX, TrendingUp, UserCircle } from 'lucide-react';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { PageState } from '@/modules/core/ui/components/PageState';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import { usePerformanceMetrics } from '@/modules/users/hooks/usePerformanceMetrics';
import { recentQuarters, type QuarterRef } from '../hooks/useKpiFilters';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../model/metric-registry';
import { KpiBand, KpiTileGrid, CountStrip } from '../ui/components/KpiBand';

const PerformancePage: React.FC = () => {
    const { user } = useAuth();
    const { isDark } = useTheme();
    const quarters = React.useMemo(() => recentQuarters(5), []);
    const [period, setPeriod] = React.useState<QuarterRef>(quarters[0]);

    // usePerformanceMetrics takes the "Q3_2026" shape, not (year, quarter).
    const quarterKey = `Q${period.quarter}_${period.year}`;
    const { data: m, isLoading, isError, error, refetch } = usePerformanceMetrics(user?.id ?? '', quarterKey);

    const periodPicker = (
        <div className="flex items-center gap-2">
            <label className={cn(text.overline, 'hidden sm:inline')} htmlFor="perf-period">Quarter</label>
            <Select
                value={period.label}
                onValueChange={(label) => setPeriod(quarters.find((q) => q.label === label) ?? quarters[0])}
            >
                <SelectTrigger id="perf-period" className={cn('w-[132px] rounded-xl', touch.targetY)}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {quarters.map((q) => <SelectItem key={q.label} value={q.label}>{q.label}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <TooltipProvider delayDuration={200}>
            <div className="flex h-full flex-col gap-4 overflow-hidden p-4 lg:p-6">
                <PersonalPageHeader title="My Performance" Icon={TrendingUp} rightActions={periodPicker} />

                <div
                    className={cn(
                        'custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[32px] border p-4 transition-all lg:p-8',
                        isDark
                            ? 'border-white/5 bg-[#1c2333]/40 shadow-2xl shadow-black/20'
                            : 'border-white bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-md',
                    )}
                >
                    {isError ? (
                        <PageState
                            state="error"
                            scope="section"
                            title="Couldn't load your performance"
                            description={error instanceof Error ? error.message : undefined}
                            onRetry={() => refetch()}
                        />
                    ) : !isLoading && !m ? (
                        <PageState
                            state="empty"
                            scope="section"
                            icon={UserCircle}
                            title={`No activity recorded in ${period.label}`}
                            description="Your numbers appear here once you have been offered, assigned or worked shifts in the quarter."
                        />
                    ) : (
                        <div className="flex flex-col gap-10">
                            <KpiBand
                                title="Overall"
                                description={`How ${period.label} looks at a glance.`}
                            >
                                <KpiTileGrid>
                                    <KpiTile
                                        label={labelFor('reliability_score')}
                                        value={isLoading ? null : formatMetric('reliability_score', m?.reliability_score)}
                                        status={statusFor('reliability_score', m?.reliability_score ?? 0)}
                                        denominator="Cancellations and no-shows weighed together"
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label={labelFor('acceptance_rate')}
                                        value={isLoading ? null : formatMetric('acceptance_rate', m?.acceptance_rate)}
                                        status={statusFor('acceptance_rate', m?.acceptance_rate ?? 0)}
                                        denominator={`of ${m?.total_offers ?? 0} offers received`}
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label="Shifts worked"
                                        value={isLoading ? null : formatMetric('shifts_worked', m?.shifts_worked)}
                                        status="neutral"
                                        denominator={`${m?.shifts_assigned ?? 0} assigned this quarter`}
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label="Emergency assignments"
                                        value={isLoading ? null : formatMetric('shifts_emergency', m?.emergency_assignments)}
                                        status="neutral"
                                        denominator="Shifts you picked up at short notice"
                                        loading={isLoading}
                                    />
                                </KpiTileGrid>
                            </KpiBand>

                            <KpiBand
                                title="Attendance"
                                description="Measured against the same ±7.5 minute grace window your timesheet uses."
                            >
                                <KpiTileGrid>
                                    <KpiTile
                                        label={labelFor('punctuality_rate')}
                                        value={isLoading ? null : formatMetric('punctuality_rate', m?.punctuality_rate)}
                                        status={statusFor('punctuality_rate', m?.punctuality_rate ?? 0)}
                                        denominator="Worked, on time in and on time out"
                                        tooltip={METRIC_REGISTRY.attendance_compliance_rate.description}
                                        loading={isLoading}
                                        icon={Activity}
                                    />
                                    <KpiTile
                                        label={labelFor('no_show_rate')}
                                        value={isLoading ? null : formatMetric('no_show_rate', m?.no_show_rate)}
                                        status={statusFor('no_show_rate', m?.no_show_rate ?? 0)}
                                        denominator={`${m?.no_shows ?? 0} missed`}
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label={labelFor('late_clock_in_rate')}
                                        value={isLoading ? null : formatMetric('late_clock_in_rate', m?.late_clock_in_rate)}
                                        status={statusFor('late_clock_in_rate', m?.late_clock_in_rate ?? 0)}
                                        denominator="More than 7.5 min after start"
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label={labelFor('early_clock_out_rate')}
                                        value={isLoading ? null : formatMetric('early_clock_out_rate', m?.early_clock_out_rate)}
                                        status={statusFor('early_clock_out_rate', m?.early_clock_out_rate ?? 0)}
                                        denominator="More than 7.5 min before end"
                                        loading={isLoading}
                                    />
                                </KpiTileGrid>
                            </KpiBand>

                            <KpiBand
                                title="Cancellations"
                                description="Two kinds, split by how much notice you gave. Twenty-four hours or less is critical, because it leaves little time to find cover."
                            >
                                <KpiTileGrid>
                                    <KpiTile
                                        label={labelFor('standard_cancel_rate')}
                                        value={isLoading ? null : formatMetric('standard_cancel_rate', m?.cancellation_rate_standard)}
                                        status={statusFor('standard_cancel_rate', m?.cancellation_rate_standard ?? 0)}
                                        denominator="More than 24 hours notice"
                                        tooltip={METRIC_REGISTRY.standard_cancel_rate.description}
                                        loading={isLoading}
                                        icon={CalendarX}
                                    />
                                    <KpiTile
                                        label={labelFor('critical_cancel_rate')}
                                        value={isLoading ? null : formatMetric('critical_cancel_rate', m?.cancellation_rate_late)}
                                        status={statusFor('critical_cancel_rate', m?.cancellation_rate_late ?? 0)}
                                        denominator="24 hours notice or less"
                                        tooltip={METRIC_REGISTRY.critical_cancel_rate.description}
                                        loading={isLoading}
                                    />
                                    <KpiTile
                                        label={labelFor('swap_rate')}
                                        value={isLoading ? null : formatMetric('swap_rate', m?.swap_ratio)}
                                        status={statusFor('swap_rate', m?.swap_ratio ?? 0)}
                                        denominator={`${m?.shifts_swapped ?? 0} traded away`}
                                        loading={isLoading}
                                        icon={ArrowLeftRight}
                                    />
                                    <KpiTile
                                        label={labelFor('ignorance_rate')}
                                        value={isLoading ? null : formatMetric('ignorance_rate', m?.offer_expiration_rate)}
                                        status={statusFor('ignorance_rate', m?.offer_expiration_rate ?? 0)}
                                        denominator={`${m?.offer_expirations ?? 0} offers left unanswered`}
                                        loading={isLoading}
                                    />
                                </KpiTileGrid>
                            </KpiBand>

                            <KpiBand title="Your quarter in counts" description="The raw numbers behind the rates above.">
                                <CountStrip
                                    items={[
                                        { label: 'Offers received', value: m?.total_offers ?? 0 },
                                        { label: 'Accepted', value: m?.shifts_accepted ?? 0 },
                                        { label: 'Rejected', value: m?.shifts_rejected ?? 0 },
                                        { label: 'Worked', value: m?.shifts_worked ?? 0 },
                                    ]}
                                />
                            </KpiBand>
                        </div>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
};

export default PerformancePage;
