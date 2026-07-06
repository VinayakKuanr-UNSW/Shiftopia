import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import {
    BiddingKpis,
    BiddingKpiKey,
    getBiddingStatus,
} from '../../model/bidding-kpis.types';

// ---------------------------------------------------------------------------
// BiddingKpiPanel — read-only, presentational panel of open-bidding KPIs.
//
// Usage:
//   const { data, isLoading } = useBiddingKpis(from, to, scope);
//   <BiddingKpiPanel kpis={data ?? EMPTY_BIDDING_KPIS} isLoading={isLoading} />
//
// Not wired into any page/route here — just exported.
// ---------------------------------------------------------------------------

type ValueFormat = 'percent' | 'avg' | 'count';

interface KpiCardSpec {
    key: BiddingKpiKey;
    label: string;
    format: ValueFormat;
    /** Optional supporting numerator/denominator counts shown as subtext. */
    support?: (kpis: BiddingKpis) => string;
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
        case 'avg':
            return value.toFixed(1);
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
        title: 'Outcomes',
        cards: [
            {
                key: 'open_shift_fill_rate',
                label: 'Open Shift Fill Rate',
                format: 'percent',
                support: (k) => `${k.winners_selected} / ${k.open_bidding_shifts} open shifts filled`,
            },
            {
                key: 'bid_success_rate',
                label: 'Bid Success Rate',
                format: 'percent',
                support: (k) => `${k.winners_selected} / ${k.total_bids} bids won`,
            },
            {
                key: 'unfilled_open_shift_rate',
                label: 'Unfilled Open Rate',
                format: 'percent',
                support: (k) => `${k.unfilled_open_shifts} / ${k.open_bidding_shifts} open unfilled`,
            },
            {
                key: 'avg_bids_per_open_shift',
                label: 'Avg Bids / Open Shift',
                format: 'avg',
                support: (k) => `${k.total_bids} bids across ${k.open_bidding_shifts} shifts`,
            },
        ],
    },
    {
        title: 'Volume',
        cards: [
            {
                key: 'open_bidding_shifts',
                label: 'Open Bidding Shifts',
                format: 'count',
            },
            {
                key: 'total_bids',
                label: 'Total Bids',
                format: 'count',
            },
            {
                key: 'winners_selected',
                label: 'Winners Selected',
                format: 'count',
            },
            {
                key: 'unfilled_open_shifts',
                label: 'Unfilled Open Shifts',
                format: 'count',
            },
        ],
    },
];

// ── Single KPI card ──────────────────────────────────────────────────────────
const KpiCard: React.FC<{ spec: KpiCardSpec; kpis: BiddingKpis }> = ({ spec, kpis }) => {
    const value = kpis[spec.key];
    const status = getBiddingStatus(spec.key, value);
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

interface BiddingKpiPanelProps {
    kpis: BiddingKpis;
    isLoading?: boolean;
}

const BiddingKpiPanel: React.FC<BiddingKpiPanelProps> = ({ kpis, isLoading }) => {
    return (
        <Card className="bg-card border-border">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-foreground">
                    Bidding KPIs
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

export default BiddingKpiPanel;
export { BiddingKpiPanel };
