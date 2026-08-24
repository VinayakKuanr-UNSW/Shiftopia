/**
 * KPI › Cancellations — what is falling out of the roster, and how late?
 *
 * Implements the minimal, consistent analytics dashboard aesthetic with:
 *  - Top sparkline KPI cards with ambient wave gradients
 *  - Weekly standard vs critical cancellation trend + Smart Cancellation Insights AI card
 *  - "Top Cancellation Reasons" horizontal progress bars matching the reference UI
 *  - Shift outcome count strips and per-employee drop rate table
 */

import React, { useState } from 'react';
import { CalendarX, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBehaviourSummary, EMPTY_BEHAVIOUR } from '../../hooks/useBehaviourSummary';
import { useCancellationReasonBreakdown } from '../../hooks/useCancellationReasonBreakdown';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY, analysisHref } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { useQuarterlyReport } from '@/modules/users/hooks/usePerformanceMetrics';
import { useBehaviourTrend, formatBucket } from '../../hooks/useBehaviourTrend';
import { KpiTrendChart, SERIES_COLORS } from '../components/KpiTrendChart';
import { KpiDetailTable, type KpiDetailRow } from '../components/KpiDetailTable';
import { EmployeeDrillDown } from '../components/EmployeeDrillDown';
import { KpiBand, CountStrip } from '../components/KpiBand';
import { KpiSmartInsights, type InsightItem } from '../components/KpiSmartInsights';
import { KpiHorizontalBars } from '../components/KpiHorizontalBars';
import { text } from '@/modules/core/ui/typography';
import { cn } from '@/modules/core/lib/utils';
import type { ScopeSelection } from '@/platform/auth/types';

interface CancellationsTabProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function CancellationsTab({ filters, scope }: CancellationsTabProps) {
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
    const reasons = useCancellationReasonBreakdown(period.startDate, period.endDate, scope);

    if (current.isError) {
        return (
            <PageState
                state="error"
                scope="section"
                title="Couldn't load cancellation KPIs"
                description={current.error instanceof Error ? current.error.message : undefined}
                onRetry={() => current.refetch()}
            />
        );
    }

    const k = current.data ?? EMPTY_BEHAVIOUR;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;
    const totalCancellations = k.standard_cancellations + k.critical_cancellations;

    if (!loading && k.held === 0) {
        return (
            <PageState
                state="empty"
                scope="section"
                icon={CalendarX}
                title={`No shifts held in ${period.label}`}
                description="Cancellations are measured against shifts people were holding. Nothing was assigned in this quarter."
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

    // Smart Cancellation Insights
    const cancelInsights: InsightItem[] = [];
    if (k.critical_cancel_rate > 5) {
        cancelInsights.push({
            id: 'crit-alert',
            type: 'alert',
            title: `Critical Drop Rate Alert (${k.critical_cancel_rate}%)`,
            description: `${k.critical_cancellations} shifts dropped with ≤24h notice, forcing short-lead emergency backfills.`,
            actionLabel: 'View backfills',
            actionHref: '/bids/manager',
        });
    } else {
        cancelInsights.push({
            id: 'crit-good',
            type: 'highlight',
            title: 'Stable Roster Retention',
            description: totalCancellations === 0
                ? 'Zero shift cancellations or drops recorded for the active quarter window.'
                : `${k.critical_cancellations} short-notice drops recorded out of ${k.held} shifts held.`,
        });
    }

    if (k.emergency_assigned > 0) {
        cancelInsights.push({
            id: 'emerg-cost',
            type: 'opportunity',
            title: `${k.emergency_assigned} Emergency Backfills Required`,
            description: 'Shifts filled under short-lead emergency protocols incurred premium rate multipliers.',
        });
    }

    // Horizontal bars for cancellation reasons
    const reasonRows = reasons.data ?? [];
    const reasonBars = reasonRows.map((r, idx) => ({
        id: r.reason_code || `reason-${idx}`,
        label: r.reason_label,
        value: r.total,
        displayValue: `${r.total} (${r.share_pct}%)`,
    }));

    return (
        <div className="flex flex-col gap-8">
            {!loading && totalCancellations === 0 && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                        <p className={cn(text.body, 'font-semibold text-emerald-700 dark:text-emerald-400')}>
                            Zero shift cancellations in {period.label}.
                        </p>
                        <p className={cn(text.caption, 'mt-0.5')}>
                            All {k.held} shifts held were worked, swapped or reassigned.
                        </p>
                    </div>
                </div>
            )}

            {/* ── Band A: 4-Card Top Headline Grid with Ambient Sparklines ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <KpiTile
                    label="Cancellation Rate"
                    value={loading ? null : formatMetric('cancel_rate', k.total_cancel_rate)}
                    status={statusFor('cancel_rate', k.total_cancel_rate)}
                    denominator={`${totalCancellations} of ${k.held} shifts held`}
                    delta={delta(k.total_cancel_rate, p?.total_cancel_rate)}
                    deltaGoodDirection="down"
                    icon={CalendarX}
                    sparklineColor="rose"
                    loading={loading}
                    href={analysisHref('cancel_rate', period.label)}
                />
                <KpiTile
                    label={labelFor('critical_cancel_rate')}
                    value={loading ? null : formatMetric('critical_cancel_rate', k.critical_cancel_rate)}
                    status={statusFor('critical_cancel_rate', k.critical_cancel_rate)}
                    denominator={`${k.critical_cancellations} with ≤24h notice`}
                    tooltip={METRIC_REGISTRY.critical_cancel_rate.description}
                    delta={delta(k.critical_cancel_rate, p?.critical_cancel_rate)}
                    deltaGoodDirection="down"
                    icon={AlertTriangle}
                    sparklineColor="amber"
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('standard_cancel_rate')}
                    value={loading ? null : formatMetric('standard_cancel_rate', k.standard_cancel_rate)}
                    status={statusFor('standard_cancel_rate', k.standard_cancel_rate)}
                    denominator={`${k.standard_cancellations} with >24h notice`}
                    tooltip={METRIC_REGISTRY.standard_cancel_rate.description}
                    delta={delta(k.standard_cancel_rate, p?.standard_cancel_rate)}
                    deltaGoodDirection="down"
                    icon={Clock}
                    sparklineColor="teal"
                    loading={loading}
                />
                <KpiTile
                    label="Emergency Backfills"
                    value={loading ? null : formatMetric('shifts_emergency', k.emergency_assigned)}
                    status="neutral"
                    denominator="Filled under short-lead conditions"
                    tooltip="What cancellations cost: a shift refilled at short notice."
                    sparklineColor="purple"
                    loading={loading}
                />
            </div>

            {/* ── Band B: Middle Row (Trend Chart 2/3 + Smart Insights 1/3) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2">
                    <KpiBand
                        title="Cancellation Trend Over Time"
                        description="Standard (>24h) and critical (≤24h) drops per week with the critical share line."
                        className="h-full justify-between"
                    >
                        {trend.isError ? (
                            <PageState
                                state="error"
                                scope="inline"
                                title="Couldn't load the cancellation trend"
                                onRetry={() => trend.refetch()}
                            />
                        ) : trend.isLoading ? (
                            <Skeleton className="h-[280px] w-full rounded-2xl" />
                        ) : (
                            <KpiTrendChart
                                data={(trend.data ?? []).map((r) => ({
                                    bucket: formatBucket(r.bucket_start),
                                    Standard: r.standard_cancellations,
                                    Critical: r.critical_cancellations,
                                    'Critical %': r.critical_cancel_rate,
                                }))}
                                xKey="bucket"
                                caption={`Cancellations by week, ${period.label}`}
                                emptyMessage={`No cancellations in ${period.label}.`}
                                series={[
                                    { key: 'Standard',   label: 'Standard (>24h)', color: SERIES_COLORS.muted, type: 'bar' },
                                    { key: 'Critical',   label: 'Critical (≤24h)', color: SERIES_COLORS.bad,   type: 'bar' },
                                    { key: 'Critical %', label: 'Critical %',      color: SERIES_COLORS.accent, type: 'line', rightAxis: true, unit: '%' },
                                ]}
                                height={260}
                            />
                        )}
                    </KpiBand>
                </div>

                <div className="lg:col-span-1 flex flex-col">
                    <KpiSmartInsights
                        title="Cancellation Insights"
                        badgeLabel="AI"
                        insights={cancelInsights}
                        className="h-full"
                    />
                </div>
            </div>

            {/* ── Band C: Reasons Breakdown (Matching Top Drop-Off Reasons) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                <KpiHorizontalBars
                    title="Top Cancellation Reasons"
                    subtitle="Primary self-reported reasons for shift drops"
                    items={reasonBars.length > 0 ? reasonBars : [
                        { id: 'none', label: 'No cancellation reasons recorded', value: 0, displayValue: '0' }
                    ]}
                    footerNote={totalCancellations > 0 ? `Based on ${totalCancellations} total recorded shift drops` : 'No dropped shifts in period'}
                />

                <div className="flex flex-col justify-between">
                    <KpiBand title="Shift Outcome Summary" description="Every terminal outcome for shifts held this quarter.">
                        {loading ? (
                            <Skeleton className="h-24 w-full rounded-2xl" />
                        ) : (
                            <CountStrip
                                items={[
                                    { label: 'Worked', value: k.worked, tone: 'text-emerald-600 dark:text-emerald-400' },
                                    { label: 'Cancelled', value: totalCancellations, tone: totalCancellations > 0 ? 'text-rose-600 dark:text-rose-400' : undefined },
                                    { label: 'Swapped Out', value: k.swapped_out, tone: 'text-blue-500' },
                                    { label: 'Reassigned', value: k.reassigned, tone: 'text-violet-600 dark:text-violet-400' },
                                ]}
                            />
                        )}
                    </KpiBand>
                </div>
            </div>

            {/* ── Band D: Employee Detail Table ── */}
            <KpiBand
                title="Employee Cancellation Breakdown"
                description="Sorted by critical cancellation rate — highlights individuals with frequent short-notice drop-offs."
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
                        defaultSort={{ key: 'urgent_drop_rate', dir: 'desc' }}
                        emptyMessage="Nobody cancelled a shift in this quarter."
                        columns={[
                            { key: 'shifts_worked', header: 'Worked', graded: false },
                            { key: 'cancel_standard', header: 'Standard', graded: false },
                            { key: 'cancel_late', header: 'Critical', graded: false },
                            { key: 'standard_drop_rate' },
                            { key: 'urgent_drop_rate' },
                            { key: 'reliability_score' },
                        ]}
                        rows={(report.data ?? []).map((r) => ({
                            id: r.employee_id,
                            name: r.employee_name,
                            values: {
                                shifts_worked: r.completed,
                                cancel_standard: r.cancel_standard,
                                cancel_late: r.cancel_late,
                                standard_drop_rate: r.standard_drop_rate ?? 0,
                                urgent_drop_rate: r.urgent_drop_rate ?? 0,
                                reliability_score: r.reliability_score,
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
