import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import {
    MarketplaceKpis,
    MarketplaceKpiKey,
    getKpiStatus,
} from '../../model/marketplace-kpis.types';

// ---------------------------------------------------------------------------
// MarketplaceKpiPanel — read-only, presentational panel of marketplace KPIs.
//
// Usage:
//   const { data, isLoading } = useMarketplaceKpis(from, to, scope);
//   <MarketplaceKpiPanel kpis={data ?? EMPTY_KPIS} isLoading={isLoading} />
//
// Not wired into any page/route here — just exported.
// ---------------------------------------------------------------------------

type ValueFormat = 'percent' | 'hours' | 'count';

interface KpiCardSpec {
    key: MarketplaceKpiKey;
    label: string;
    format: ValueFormat;
    /** Optional supporting numerator/denominator counts shown as subtext. */
    support?: (kpis: MarketplaceKpis) => string;
}

interface KpiGroupSpec {
    title: string;
    cards: KpiCardSpec[];
}

// ── Value formatting ────────────────────────────────────────────────────────
const formatValue = (value: number, format: ValueFormat): string => {
    switch (format) {
        case 'percent':
            return `${value.toFixed(1)}%`;
        case 'hours':
            return `${value.toFixed(1)} h`;
        case 'count':
        default:
            return `${value}`;
    }
};

// ── Status → Tailwind colour (light + dark safe) ─────────────────────────────
const STATUS_VALUE_CLASS: Record<'good' | 'warn' | 'critical', string> = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    critical: 'text-rose-600 dark:text-rose-400',
};

const STATUS_DOT_CLASS: Record<'good' | 'warn' | 'critical', string> = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    critical: 'bg-rose-500',
};

// ── Panel layout / grouping ──────────────────────────────────────────────────
const KPI_GROUPS: KpiGroupSpec[] = [
    {
        title: 'Coverage',
        cards: [
            {
                key: 'fill_rate',
                label: 'Fill Rate',
                format: 'percent',
                support: (k) => `${k.filled_shifts} / ${k.published_shifts} published filled`,
            },
            {
                key: 'open_coverage_rate',
                label: 'Open Coverage',
                format: 'percent',
                support: (k) => `${k.covered_open_shifts} / ${k.open_shifts} open covered`,
            },
            {
                key: 'avg_time_to_fill_hours',
                label: 'Avg Time to Fill',
                format: 'hours',
            },
        ],
    },
    {
        title: 'Stability',
        cards: [
            {
                key: 'churn_rate',
                label: 'Churn Rate',
                format: 'percent',
                support: (k) =>
                    `${k.published_snapshots} snapshots / ${k.distinct_filled_shifts} distinct filled`,
            },
        ],
    },
    {
        title: 'Marketplace',
        cards: [
            {
                key: 'marketplace_utilization_rate',
                label: 'Utilization',
                format: 'percent',
                support: (k) =>
                    `${k.marketplace_used_shifts} / ${k.marketplace_eligible_shifts} eligible used`,
            },
            {
                key: 'offer_accept_rate',
                label: 'Offer Accept',
                format: 'percent',
                support: (k) => `${k.offers_resolved} offers resolved`,
            },
            {
                key: 'offer_reject_rate',
                label: 'Offer Reject',
                format: 'percent',
                support: (k) => `${k.offers_resolved} offers resolved`,
            },
            {
                key: 'offer_ignore_rate',
                label: 'Offer Ignore',
                format: 'percent',
                support: (k) => `${k.offers_resolved} offers resolved`,
            },
            {
                key: 'trade_completion_rate',
                label: 'Trade Completion',
                format: 'percent',
                support: (k) => `${k.trades_initiated} trades initiated`,
            },
            {
                key: 'trade_rejection_rate',
                label: 'Trade Rejection',
                format: 'percent',
                support: (k) => `${k.trades_initiated} trades initiated`,
            },
            {
                key: 'trade_cancellation_rate',
                label: 'Trade Cancellation',
                format: 'percent',
                support: (k) => `${k.trades_initiated} trades initiated`,
            },
            {
                key: 'trade_expiry_rate',
                label: 'Trade Expiry',
                format: 'percent',
                support: (k) => `${k.trades_initiated} trades initiated`,
            },
        ],
    },
];

// ── Single KPI card ──────────────────────────────────────────────────────────
const KpiCard: React.FC<{ spec: KpiCardSpec; kpis: MarketplaceKpis }> = ({ spec, kpis }) => {
    const value = kpis[spec.key];
    const status = getKpiStatus(spec.key, value);
    const support = spec.support?.(kpis);

    return (
        <div className="rounded-lg border border-border bg-card/60 p-4 transition-colors hover:bg-accent/5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{spec.label}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
            </div>
            <div className={`mt-2 text-2xl font-bold tabular-nums ${STATUS_VALUE_CLASS[status]}`}>
                {formatValue(value, spec.format)}
            </div>
            {support && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{support}</p>}
        </div>
    );
};

// ── Loading skeleton card ────────────────────────────────────────────────────
const SkeletonCard: React.FC = () => (
    <div className="rounded-lg border border-border bg-card/60 p-4">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-16 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-2.5 w-28 animate-pulse rounded bg-muted/70" />
    </div>
);

interface MarketplaceKpiPanelProps {
    kpis: MarketplaceKpis;
    isLoading?: boolean;
}

const MarketplaceKpiPanel: React.FC<MarketplaceKpiPanelProps> = ({ kpis, isLoading }) => {
    return (
        <Card className="bg-card border-border">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-foreground">
                    Marketplace KPIs
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {KPI_GROUPS.map((group) => (
                    <section key={group.title}>
                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.title}
                        </h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {group.cards.map((spec) =>
                                isLoading ? (
                                    <SkeletonCard key={spec.key} />
                                ) : (
                                    <KpiCard key={spec.key} spec={spec} kpis={kpis} />
                                ),
                            )}
                        </div>
                    </section>
                ))}
            </CardContent>
        </Card>
    );
};

export default MarketplaceKpiPanel;
export { MarketplaceKpiPanel };
