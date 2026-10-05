/**
 * Manager scorecard — how the roster was run, rather than how people behaved.
 *
 * get_manager_scorecard has been deployed all along and rendered nowhere.
 * Visible to everyone who reaches the KPI page, which is gamma and above:
 * gamma holds sub-department scope, delta all sub-departments, epsilon all
 * departments. The scope filter already narrows it to what the viewer may see,
 * and the RPC intersects the request with their allowed scope tree regardless.
 */

import React from 'react';
import { Clock3, Repeat, Siren, Percent } from 'lucide-react';
import { KpiTile } from '@/modules/core/ui/components/KpiTile';
import { useManagerScorecard } from '../../hooks/useManagerScorecard';
import { EMPTY_SCORECARD } from '../../model/manager-scorecard.types';
import { statusFor, formatMetric, labelFor, METRIC_REGISTRY } from '../../model/metric-registry';
import { computeDelta, type KpiFilters } from '../../hooks/useKpiFilters';
import { KpiBand, KpiTileGrid, CountStrip } from '../components/KpiBand';
import type { ScopeSelection } from '@/platform/auth/types';

interface ManagerScorecardBandProps {
    filters: KpiFilters;
    scope: ScopeSelection;
}

export default function ManagerScorecardBand({ filters, scope }: ManagerScorecardBandProps) {
    const { period, comparison } = filters;
    const current = useManagerScorecard(period.startDate, period.endDate, scope);
    const prior = useManagerScorecard(
        comparison?.startDate ?? '',
        comparison?.endDate ?? '',
        scope,
    );

    // A failing scorecard should not take the whole Overview tab down with it,
    // so this band stays quiet rather than rendering an error over its siblings.
    if (current.isError) return null;

    const k = current.data ?? EMPTY_SCORECARD;
    const p = comparison ? prior.data : undefined;
    const loading = current.isLoading;

    if (!loading && k.managed_published_shifts === 0) return null;

    const delta = (cur: number, prev: number | undefined, unit: 'points' | 'percent') =>
        comparison && prev !== undefined
            ? computeDelta(cur, prev, {
                unit,
                label: `vs ${comparison.label}`,
                currentBase: k.managed_published_shifts,
                previousBase: p?.managed_published_shifts,
            })
            : null;

    return (
        <KpiBand
            title="How the roster was run"
            description="Scheduling behaviour rather than employee behaviour — lead time, churn and how often a shift had to be filled in a hurry."
        >
            <KpiTileGrid>
                <KpiTile
                    label={labelFor('avg_publish_lead_time_hours')}
                    value={loading ? null : formatMetric('avg_publish_lead_time_hours', k.avg_publish_lead_time_hours)}
                    status={statusFor('avg_publish_lead_time_hours', k.avg_publish_lead_time_hours)}
                    denominator={`across ${k.managed_published_shifts} published shifts`}
                    tooltip={METRIC_REGISTRY.avg_publish_lead_time_hours.description}
                    delta={delta(k.avg_publish_lead_time_hours, p?.avg_publish_lead_time_hours, 'percent')}
                    deltaGoodDirection="up"
                    icon={Clock3}
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('churn_rate')}
                    value={loading ? null : formatMetric('churn_rate', k.churn_rate)}
                    status={statusFor('churn_rate', k.churn_rate)}
                    denominator={`${k.reassignment_count} re-assignments after publish`}
                    delta={delta(k.churn_rate, p?.churn_rate, 'points')}
                    deltaGoodDirection="down"
                    icon={Repeat}
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('emergency_fill_rate')}
                    value={loading ? null : formatMetric('emergency_fill_rate', k.emergency_fill_rate)}
                    status={statusFor('emergency_fill_rate', k.emergency_fill_rate)}
                    denominator={`${k.emergency_fill_count} filled at short notice`}
                    delta={delta(k.emergency_fill_rate, p?.emergency_fill_rate, 'points')}
                    deltaGoodDirection="down"
                    icon={Siren}
                    loading={loading}
                />
                <KpiTile
                    label={labelFor('open_coverage_rate')}
                    value={loading ? null : formatMetric('open_coverage_rate', k.open_coverage_rate)}
                    status={statusFor('open_coverage_rate', k.open_coverage_rate)}
                    denominator={`${k.covered_open_shifts} of ${k.open_shifts} open shifts covered`}
                    delta={delta(k.open_coverage_rate, p?.open_coverage_rate, 'points')}
                    deltaGoodDirection="up"
                    icon={Percent}
                    loading={loading}
                />
            </KpiTileGrid>

            {!loading && (
                <CountStrip
                    className="mt-3"
                    items={[
                        { label: 'Manager actions', value: k.manager_actions },
                        { label: 'Employee actions', value: k.employee_actions },
                        { label: 'System actions', value: k.system_actions },
                        { label: 'Published shifts', value: k.managed_published_shifts },
                    ]}
                />
            )}
        </KpiBand>
    );
}
