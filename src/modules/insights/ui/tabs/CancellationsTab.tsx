/**
 * KPI › Cancellations — what is falling out of the roster, and how late?
 *
 * There are exactly two kinds, and the discriminator is notice, not intent:
 *   standard  more than 24 hours notice  (assignment_snapshots 'dropped_std')
 *   critical  24 hours notice or less    (assignment_snapshots 'dropped_late')
 *
 * 24h, not 4h. 4h is the urgent/emergent boundary — where the app blocks
 * exchange operations outright — and using it as the cancellation split put
 * the line inside the window where an employee cannot cancel at all.
 *
 * Three other things in the product share the word and are named apart, so no
 * number on this tab is ambiguous: a manager cancelling the whole shift is a
 * "cancelled shift", a requester pulling a swap is a "withdrawn swap" (owned by
 * the Swaps tab), and a bid pulled before award is a "withdrawn bid".
 *
 * Until this release none of these numbers could be non-zero: an employee drop
 * wrote an UNASSIGNED event, never CANCELLED, so the episodes view closed it as
 * 'unassigned' and no cancellation metric ever saw it. See migration
 * 20260823090200.
 */

import React from 'react';
import { CalendarX, Clock, AlertTriangle } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBehaviourSummary, EMPTY_BEHAVIOUR } from '../../hooks/useBehaviourSummary';
import { useCancellationReasonBreakdown } from '../../hooks/useCancellationReasonBreakdown';
import { ReasonBreakdown } from '../components/ReasonBreakdown';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { KpiBand, KpiTileGrid, CountStrip } from '../components/KpiBand';
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

    // Zero cancellations is a GOOD outcome. It must not read like an error, and
    // it must be distinguishable from "no shifts at all this quarter".
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

    return (
        <div className="flex flex-col gap-8">
            {!loading && totalCancellations === 0 && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                    <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                        <p className={cn(text.body, 'font-semibold text-emerald-700 dark:text-emerald-400')}>
                            Nobody dropped a shift in {period.label}.
                        </p>
                        <p className={cn(text.caption, 'mt-0.5')}>
                            All {k.held} shifts held were worked, swapped or reassigned.
                        </p>
                    </div>
                </div>
            )}

            <KpiBand title="Headline" description="Shifts released by the person holding them.">
                <KpiTileGrid>
                    <KpiTile
                        label="Cancellation rate"
                        value={loading ? null : formatMetric('cancel_rate', k.total_cancel_rate)}
                        status={statusFor('cancel_rate', k.total_cancel_rate)}
                        denominator={`${totalCancellations} of ${k.held} shifts held`}
                        delta={delta(k.total_cancel_rate, p?.total_cancel_rate)}
                        deltaGoodDirection="down"
                        icon={CalendarX}
                        loading={loading}
                        href="/insights/cancel_rate"
                    />
                    <KpiTile
                        label={labelFor('critical_cancel_rate')}
                        value={loading ? null : formatMetric('critical_cancel_rate', k.critical_cancel_rate)}
                        status={statusFor('critical_cancel_rate', k.critical_cancel_rate)}
                        denominator={`${k.critical_cancellations} with 24h notice or less`}
                        tooltip={METRIC_REGISTRY.critical_cancel_rate.description}
                        delta={delta(k.critical_cancel_rate, p?.critical_cancel_rate)}
                        deltaGoodDirection="down"
                        icon={AlertTriangle}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('standard_cancel_rate')}
                        value={loading ? null : formatMetric('standard_cancel_rate', k.standard_cancel_rate)}
                        status={statusFor('standard_cancel_rate', k.standard_cancel_rate)}
                        denominator={`${k.standard_cancellations} with more than 24h notice`}
                        tooltip={METRIC_REGISTRY.standard_cancel_rate.description}
                        delta={delta(k.standard_cancel_rate, p?.standard_cancel_rate)}
                        deltaGoodDirection="down"
                        icon={Clock}
                        loading={loading}
                    />
                    <KpiTile
                        label="Emergency backfills"
                        value={loading ? null : formatMetric('shifts_emergency', k.emergency_assigned)}
                        status="neutral"
                        denominator="Shifts filled under short-lead conditions"
                        tooltip="What cancellations cost: a shift refilled at short notice."
                        loading={loading}
                    />
                </KpiTileGrid>
            </KpiBand>

            <KpiBand
                title="Why people cancelled"
                description="Chosen by the employee at the moment they drop the shift. Each bar is split by how much notice the reason usually comes with."
            >
                {loading || reasons.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                ) : reasons.isError ? (
                    <PageState
                        state="error"
                        scope="inline"
                        title="Couldn't load the reason breakdown"
                        onRetry={() => reasons.refetch()}
                    />
                ) : totalCancellations === 0 ? (
                    <p className={cn(text.bodyMuted, 'rounded-2xl border border-border bg-muted/30 p-4')}>
                        No cancellations to break down in {period.label}.
                    </p>
                ) : (reasons.data ?? []).length === 0 ? (
                    /* Cancellations exist but none carries a reason — they predate
                       reason capture. Say which, rather than showing an empty chart. */
                    <p className={cn(text.bodyMuted, 'rounded-2xl border border-dashed border-border bg-muted/20 p-4')}>
                        {totalCancellations} cancellation{totalCancellations === 1 ? '' : 's'} in {period.label},
                        none with a recorded reason. Reasons are captured on every drop from this release onward.
                    </p>
                ) : (
                    <ReasonBreakdown rows={reasons.data ?? []} />
                )}
            </KpiBand>

            <KpiBand title="Where the shifts went" description="Every terminal outcome for shifts held this quarter.">
                {loading ? (
                    <Skeleton className="h-20 w-full" />
                ) : (
                    <CountStrip
                        items={[
                            { label: 'Worked', value: k.worked, tone: 'text-emerald-600 dark:text-emerald-400' },
                            { label: 'Cancelled', value: totalCancellations, tone: totalCancellations > 0 ? 'text-rose-600 dark:text-rose-400' : undefined },
                            { label: 'Swapped out', value: k.swapped_out },
                            { label: 'Reassigned', value: k.reassigned },
                        ]}
                    />
                )}
            </KpiBand>
        </div>
    );
}
