/**
 * KPI › Attendance — did the people who were rostered actually turn up, on time?
 *
 * The nine metrics are the same nine AttendanceMetricsBar renders for one
 * employee on My Attendance and Timesheets. Same definitions, same 7.5-minute
 * grace window, different scope — so the org view and the personal view are
 * visibly the same object and their numbers reconcile.
 *
 * A no-show lives here, not under Cancellations: it is a failure to attend a
 * shift the employee still holds, where a cancellation releases the shift in
 * time for someone else to be found. One leaves a hole on the night.
 */

import React from 'react';
import { Activity, CheckCircle2, Clock, UserX } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBehaviourSummary, EMPTY_BEHAVIOUR } from '../../hooks/useBehaviourSummary';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { useQuarterlyReport } from '@/modules/users/hooks/usePerformanceMetrics';
import { KpiDetailTable } from '../components/KpiDetailTable';
import { KpiBand, KpiTileGrid } from '../components/KpiBand';
import { RateStrip } from '../components/RateStrip';
import type { ScopeSelection } from '@/platform/auth/types';

interface AttendanceTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function AttendanceTab({ filters, scope }: AttendanceTabProps) {
    const { period, comparison } = filters;

    const current = useBehaviourSummary(period.startDate, period.endDate, scope);
    const prior = useBehaviourSummary(
        comparison?.startDate ?? '',
        comparison?.endDate ?? '',
        scope,
    );
    // Per-employee detail. Same query key as every other tab and the Overview
    // report, so React Query serves one request no matter how many tabs read it.
    const report = useQuarterlyReport(period.year, period.quarter, scope);

    if (current.isError) {
        return (
            <PageState
                state="error"
                scope="section"
                title="Couldn't load attendance KPIs"
                description={current.error instanceof Error ? current.error.message : undefined}
                onRetry={() => current.refetch()}
            />
        );
    }

    const k = current.data ?? EMPTY_BEHAVIOUR;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;

    // Attendance is only computable once a shift has ended.
    if (!loading && k.held === 0) {
        return (
            <PageState
                state="empty"
                scope="section"
                icon={Activity}
                title={`No completed shifts in ${period.label}`}
                description="Attendance is measured on shifts that have ended. Numbers appear here once the quarter has shifts behind it."
            />
        );
    }

    const delta = (cur: number, prev: number | undefined) =>
        comparison && prev !== undefined
            ? computeDelta(cur, prev, {
                unit: 'points',
                label: `vs ${comparison.label}`,
                currentBase: k.held,
                previousBase: p?.held,
            })
            : null;

    return (
        <div className="flex flex-col gap-8">
            <KpiBand
                title="Headline"
                description={`Across ${k.employees} ${k.employees === 1 ? 'employee' : 'employees'} in ${period.label}.`}
            >
                <KpiTileGrid>
                    <KpiTile
                        label={labelFor('attendance_compliance_rate')}
                        value={loading ? null : formatMetric('attendance_compliance_rate', k.attendance_compliance_rate)}
                        status={statusFor('attendance_compliance_rate', k.attendance_compliance_rate)}
                        denominator={`${k.attendance_compliant} of ${k.worked} shifts worked`}
                        tooltip={METRIC_REGISTRY.attendance_compliance_rate.description}
                        delta={delta(k.attendance_compliance_rate, p?.attendance_compliance_rate)}
                        deltaGoodDirection="up"
                        icon={CheckCircle2}
                        loading={loading}
                        href="/insights/attendance_compliance_rate"
                    />
                    <KpiTile
                        label={labelFor('no_show_rate')}
                        value={loading ? null : formatMetric('no_show_rate', k.no_show_rate)}
                        status={statusFor('no_show_rate', k.no_show_rate)}
                        denominator={`${k.no_show} of ${k.held} shifts held`}
                        tooltip={METRIC_REGISTRY.no_show_rate.description}
                        delta={delta(k.no_show_rate, p?.no_show_rate)}
                        deltaGoodDirection="down"
                        icon={UserX}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('on_time_in_rate')}
                        value={loading ? null : formatMetric('on_time_in_rate', k.on_time_in_rate)}
                        status={statusFor('on_time_in_rate', k.on_time_in_rate)}
                        denominator={`${k.on_time_in} of ${k.worked} worked`}
                        tooltip={METRIC_REGISTRY.on_time_in_rate.description}
                        delta={delta(k.on_time_in_rate, p?.on_time_in_rate)}
                        deltaGoodDirection="up"
                        icon={Clock}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('shifts_worked')}
                        value={loading ? null : formatMetric('shifts_worked', k.worked)}
                        status="neutral"
                        denominator="The denominator for every rate here"
                        loading={loading}
                    />
                </KpiTileGrid>
            </KpiBand>

            <KpiBand
                title="Clock behaviour"
                description="The same nine measures the personal scorecard shows on My Attendance and Timesheets, at org scope. Grace window is ±7.5 minutes."
            >
                {loading ? (
                    <Skeleton className="h-24 w-full" />
                ) : (
                    <RateStrip
                        items={[
                            { metricId: 'early_clock_in_rate',  value: k.early_clock_in_rate },
                            { metricId: 'on_time_in_rate',      value: k.on_time_in_rate },
                            { metricId: 'late_clock_in_rate',   value: k.late_clock_in_rate },
                            { metricId: 'early_clock_out_rate', value: k.early_clock_out_rate },
                            { metricId: 'on_time_out_rate',     value: k.on_time_out_rate },
                            { metricId: 'late_clock_out_rate',  value: k.late_clock_out_rate },
                            { metricId: 'auto_clock_out_rate',  value: k.auto_clock_out_rate },
                            { metricId: 'no_show_rate',         value: k.no_show_rate },
                        ]}
                    />
                )}
            </KpiBand>

            <KpiBand
                title="Who needs attention"
                description="Sorted by attendance compliance ascending — the people furthest from target come first."
            >
                {report.isError ? (
                    <PageState
                        state="error"
                        scope="inline"
                        title="Couldn't load the per-employee breakdown"
                        onRetry={() => report.refetch()}
                    />
                ) : report.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                ) : (
                    <KpiDetailTable
                        caption={`${(report.data ?? []).length} people · ${period.label}`}
                        defaultSort={{ key: 'attendance_compliance_rate', dir: 'asc' }}
                        emptyMessage="No one worked a shift in this quarter."
                        columns={[
                            { key: 'shifts_worked', header: 'Worked', graded: false },
                            { key: 'attendance_compliance_rate' },
                            { key: 'on_time_in_rate' },
                            { key: 'late_clock_in_rate' },
                            { key: 'early_clock_out_rate' },
                            { key: 'no_show_rate' },
                        ]}
                        rows={(report.data ?? []).map((r) => ({
                            id: r.employee_id,
                            name: r.employee_name,
                            values: {
                            shifts_worked: r.completed,
                            attendance_compliance_rate: r.attendance_compliance_rate ?? 0,
                            on_time_in_rate: r.on_time_in_rate ?? 0,
                            late_clock_in_rate: r.late_clock_in_rate,
                            early_clock_out_rate: r.early_clock_out_rate,
                            no_show_rate: r.no_show_rate,
                            },
                        }))}
                    />
                )}
            </KpiBand>
        </div>
    );
}
