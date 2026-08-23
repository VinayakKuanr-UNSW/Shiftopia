/**
 * KPI › Cancellations — what is falling out of the roster, and how late?
 *
 * There are exactly two kinds, and the discriminator is notice, not intent:
 *   standard  4 hours notice or more   (assignment_snapshots 'dropped_std')
 *   urgent    less than 4 hours        (assignment_snapshots 'dropped_late')
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
import { CalendarX, Clock, AlertTriangle, Ban } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useBehaviourSummary, EMPTY_BEHAVIOUR } from '../../hooks/useBehaviourSummary';
import { useCancellationReasons } from '../../hooks/useCancellationReasons';
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
    const reasons = useCancellationReasons();

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
    const totalCancellations = k.standard_cancellations + k.urgent_cancellations;

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
                        label={labelFor('urgent_cancel_rate')}
                        value={loading ? null : formatMetric('urgent_cancel_rate', k.urgent_cancel_rate)}
                        status={statusFor('urgent_cancel_rate', k.urgent_cancel_rate)}
                        denominator={`${k.urgent_cancellations} inside 4 hours`}
                        tooltip={METRIC_REGISTRY.urgent_cancel_rate.description}
                        delta={delta(k.urgent_cancel_rate, p?.urgent_cancel_rate)}
                        deltaGoodDirection="down"
                        icon={AlertTriangle}
                        loading={loading}
                    />
                    <KpiTile
                        label={labelFor('standard_cancel_rate')}
                        value={loading ? null : formatMetric('standard_cancel_rate', k.standard_cancel_rate)}
                        status={statusFor('standard_cancel_rate', k.standard_cancel_rate)}
                        denominator={`${k.standard_cancellations} with 4+ hours notice`}
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
                description="Chosen by the employee at the moment they drop the shift."
            >
                {loading || reasons.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                ) : totalCancellations === 0 ? (
                    <p className={cn(text.bodyMuted, 'rounded-2xl border border-border bg-muted/30 p-4')}>
                        No cancellations to break down in {period.label}.
                    </p>
                ) : (
                    <ReasonBreakdownPlaceholder count={totalCancellations} />
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

/**
 * The reason distribution needs a per-reason aggregate over shift_events
 * metadata, which is the next slice of work. Until then the tab says what it
 * is waiting for rather than rendering an empty chart that looks broken.
 */
function ReasonBreakdownPlaceholder({ count }: { count: number }) {
    return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4">
            <p className={cn(text.body, 'text-foreground')}>
                {count} cancellation{count === 1 ? '' : 's'} recorded with a reason.
            </p>
            <p className={cn(text.caption, 'mt-1')}>
                Reasons are captured on every drop from this release. The distribution chart
                lands with the per-reason aggregate.
            </p>
        </div>
    );
}
