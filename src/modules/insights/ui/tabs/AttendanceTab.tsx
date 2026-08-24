/**
 * KPI › Attendance — did the people who were rostered actually turn up, on time?
 *
 * Implements the minimal, consistent analytics dashboard aesthetic with:
 *  - Top sparkline KPI cards with ambient wave gradients
 *  - Attendance Trend Over Time + Smart Attendance Insights AI card
 *  - Clock Behaviour rate strip with ±7.5 min grace window
 *  - Who needs attention detail table
 */

import React, { useState } from 'react';
import { Activity, CheckCircle2, Clock, UserX, AlertTriangle, ShieldCheck } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBehaviourSummary, EMPTY_BEHAVIOUR } from '../../hooks/useBehaviourSummary';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY, analysisHref } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { useQuarterlyReport } from '@/modules/users/hooks/usePerformanceMetrics';
import { useBehaviourTrend, formatBucket } from '../../hooks/useBehaviourTrend';
import { KpiTrendChart, SERIES_COLORS } from '../components/KpiTrendChart';
import { KpiDetailTable, type KpiDetailRow } from '../components/KpiDetailTable';
import { EmployeeDrillDown } from '../components/EmployeeDrillDown';
import { KpiBand } from '../components/KpiBand';
import { RateStrip } from '../components/RateStrip';
import { KpiSmartInsights, type InsightItem } from '../components/KpiSmartInsights';
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
    const report = useQuarterlyReport(period.year, period.quarter, scope);
    const [selected, setSelected] = useState<KpiDetailRow | null>(null);
    const trend = useBehaviourTrend(period.startDate, period.endDate, scope);

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

    // Smart Attendance Insights
    const attendanceInsights: InsightItem[] = [];
    if (k.no_show_rate > 3) {
        attendanceInsights.push({
            id: 'noshow-alert',
            type: 'alert',
            title: `High No-Show Rate (${k.no_show_rate}%)`,
            description: `${k.no_show} unexcused missed shifts recorded. Follow up with employees via Timesheets.`,
            actionLabel: 'Review timesheets',
            actionHref: '/timesheets',
        });
    } else {
        attendanceInsights.push({
            id: 'noshow-good',
            type: 'highlight',
            title: 'Reliable Attendance Record',
            description: `${k.attendance_compliance_rate}% attendance compliance across ${k.worked} completed shifts.`,
        });
    }

    if (k.late_clock_in_rate > 10) {
        attendanceInsights.push({
            id: 'late-in-opp',
            type: 'opportunity',
            title: 'Late Clock-Ins Outside Grace Window',
            description: `${k.late_clock_in_rate}% of shifts clocked in >7.5 min late. Consider automated broadcast shift reminders.`,
        });
    }

    if (k.on_time_in_rate >= 85) {
        attendanceInsights.push({
            id: 'ontime-high',
            type: 'info',
            title: 'High Punctuality Standard',
            description: `${k.on_time_in_rate}% on-time clock-in rate within standard ±7.5m grace window.`,
        });
    }

    return (
        <div className="flex flex-col gap-8">
            {/* ── Band A: 4-Card Top Headline Grid with Ambient Sparklines ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <KpiTile
                    label={labelFor('attendance_compliance_rate')}
                    value={loading ? null : formatMetric('attendance_compliance_rate', k.attendance_compliance_rate)}
                    status={statusFor('attendance_compliance_rate', k.attendance_compliance_rate)}
                    denominator={`${k.attendance_compliant} of ${k.worked} shifts worked`}
                    tooltip={METRIC_REGISTRY.attendance_compliance_rate.description}
                    delta={delta(k.attendance_compliance_rate, p?.attendance_compliance_rate)}
                    deltaGoodDirection="up"
                    icon={CheckCircle2}
                    sparklineColor="emerald"
                    loading={loading}
                    href={analysisHref('attendance_compliance_rate', period.label)}
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
                    sparklineColor="rose"
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
                    sparklineColor="teal"
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('shifts_worked')}
                    value={loading ? null : formatMetric('shifts_worked', k.worked)}
                    status="neutral"
                    denominator="Total shifts completed"
                    sparklineColor="blue"
                    loading={loading}
                />
            </div>

            {/* ── Band B: Middle Row (Trend Chart 2/3 + Smart Insights 1/3) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2">
                    <KpiBand
                        title="Attendance Trend Over Time"
                        description="Weekly composition of on-time, late, early and missed shifts with compliance rate."
                        className="h-full justify-between"
                    >
                        {trend.isError ? (
                            <PageState
                                state="error"
                                scope="inline"
                                title="Couldn't load the attendance trend"
                                onRetry={() => trend.refetch()}
                            />
                        ) : trend.isLoading ? (
                            <Skeleton className="h-[280px] w-full rounded-2xl" />
                        ) : (
                            <KpiTrendChart
                                data={(trend.data ?? []).map((r) => ({
                                    bucket: formatBucket(r.bucket_start),
                                    'On time': r.on_time_in,
                                    'Late in': r.late_clock_in,
                                    'Early out': r.early_clock_out,
                                    'No-show': r.no_show,
                                    'Compliance %': r.attendance_compliance_rate,
                                }))}
                                xKey="bucket"
                                caption={`Attendance by week, ${period.label}`}
                                emptyMessage={`No shifts ended in ${period.label}.`}
                                series={[
                                    { key: 'On time',   label: 'On time',   color: SERIES_COLORS.good,  type: 'bar' },
                                    { key: 'Late in',   label: 'Late in',   color: SERIES_COLORS.warn,  type: 'bar' },
                                    { key: 'Early out', label: 'Early out', color: SERIES_COLORS.muted, type: 'bar' },
                                    { key: 'No-show',   label: 'No-show',   color: SERIES_COLORS.bad,   type: 'bar' },
                                    { key: 'Compliance %', label: 'Compliance %', color: SERIES_COLORS.primary, type: 'line', rightAxis: true, unit: '%' },
                                ]}
                                height={260}
                            />
                        )}
                    </KpiBand>
                </div>

                <div className="lg:col-span-1 flex flex-col">
                    <KpiSmartInsights
                        title="Attendance Insights"
                        badgeLabel="AI"
                        insights={attendanceInsights}
                        className="h-full"
                    />
                </div>
            </div>

            {/* ── Band C: Clock Behaviour Rate Strip ── */}
            <KpiBand
                title="Clock Behaviour Dimensions"
                description="The same nine measures the personal scorecard shows on My Attendance and Timesheets, at org scope (grace window is ±7.5 minutes)."
            >
                {loading ? (
                    <Skeleton className="h-24 w-full rounded-2xl" />
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

            {/* ── Band D: Employee Detail Table ── */}
            <KpiBand
                title="Employee Attendance Breakdown"
                description="Sorted by attendance compliance ascending — highlights individuals who may require scheduling support."
            >
                {report.isError ? (
                    <PageState
                        state="error"
                        scope="inline"
                        title="Couldn't load the per-employee breakdown"
                        onRetry={() => report.refetch()}
                    />
                ) : report.isLoading ? (
                    <Skeleton className="h-48 w-full rounded-2xl" />
                ) : (
                    <KpiDetailTable
                        caption={`${(report.data ?? []).length} employees · ${period.label}`}
                        onSelect={setSelected}
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

            <EmployeeDrillDown
                employeeId={selected?.id ?? null}
                employeeName={selected?.name ?? ''}
                periodLabel={period.label}
                year={period.year}
                quarter={period.quarter}
                onClose={() => setSelected(null)}
            />
        </div>
    );
}
