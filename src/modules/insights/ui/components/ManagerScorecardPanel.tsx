import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/modules/core/ui/primitives/card';
import {
    ManagerScorecard,
    ManagerScorecardKey,
    getScorecardStatus,
} from '../../model/manager-scorecard.types';

// ---------------------------------------------------------------------------
// ManagerScorecardPanel — read-only, presentational panel of manager metrics.
//
// Usage:
//   const { data, isLoading } = useManagerScorecard(from, to, scope);
//   <ManagerScorecardPanel scorecard={data ?? EMPTY_SCORECARD} isLoading={isLoading} />
//
// Not wired into any page/route here — just exported.
// ---------------------------------------------------------------------------

type ValueFormat = 'percent' | 'hours' | 'count';

interface ScorecardCardSpec {
    key: ManagerScorecardKey;
    label: string;
    format: ValueFormat;
    /** Optional supporting raw counts shown as subtext. */
    support?: (s: ManagerScorecard) => string;
}

interface ScorecardGroupSpec {
    title: string;
    cards: ScorecardCardSpec[];
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
const SCORECARD_GROUPS: ScorecardGroupSpec[] = [
    {
        title: 'Coverage',
        cards: [
            {
                key: 'fill_rate',
                label: 'Fill Rate',
                format: 'percent',
                support: (s) =>
                    `${s.filled_shifts} / ${s.managed_published_shifts} published filled`,
            },
            {
                key: 'open_coverage_rate',
                label: 'Open Coverage',
                format: 'percent',
                support: (s) => `${s.covered_open_shifts} / ${s.open_shifts} open covered`,
            },
            {
                key: 'avg_publish_lead_time_hours',
                label: 'Avg Publish Lead Time',
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
                support: (s) =>
                    `${s.published_snapshots} snapshots / ${s.distinct_shifts} distinct shifts`,
            },
            {
                key: 'reassignment_count',
                label: 'Reassignments',
                format: 'count',
            },
            {
                key: 'emergency_fill_rate',
                label: 'Emergency Fill Rate',
                format: 'percent',
                support: (s) => `${s.emergency_fill_count} emergency fills`,
            },
        ],
    },
];

// ── Single metric card (thresholded rates / counts) ──────────────────────────
const ScorecardCard: React.FC<{ spec: ScorecardCardSpec; scorecard: ManagerScorecard }> = ({
    spec,
    scorecard,
}) => {
    const value = scorecard[spec.key];
    const status = getScorecardStatus(spec.key, value);
    const support = spec.support?.(scorecard);

    return (
        <div className="rounded-lg border border-border bg-card/60 p-4 transition-colors hover:bg-accent/5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{spec.label}</span>
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`}
                    aria-hidden
                />
            </div>
            <div className={`mt-2 text-2xl font-bold tabular-nums ${STATUS_VALUE_CLASS[status]}`}>
                {formatValue(value, spec.format)}
            </div>
            {support && (
                <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{support}</p>
            )}
        </div>
    );
};

// ── Activity breakdown (three neutral counts side-by-side) ───────────────────
const ACTIVITY_BREAKDOWN: { key: ManagerScorecardKey; label: string }[] = [
    { key: 'manager_actions', label: 'Manager' },
    { key: 'employee_actions', label: 'Employee' },
    { key: 'system_actions', label: 'System' },
];

const ActivityBreakdown: React.FC<{ scorecard: ManagerScorecard }> = ({ scorecard }) => (
    <div className="grid grid-cols-3 gap-3">
        {ACTIVITY_BREAKDOWN.map(({ key, label }) => (
            <div
                key={key}
                className="rounded-lg border border-border bg-card/60 p-4 text-center"
            >
                <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {scorecard[key]}
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </div>
            </div>
        ))}
    </div>
);

// ── Loading skeleton card ────────────────────────────────────────────────────
const SkeletonCard: React.FC = () => (
    <div className="rounded-lg border border-border bg-card/60 p-4">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-16 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-2.5 w-28 animate-pulse rounded bg-muted/70" />
    </div>
);

interface ManagerScorecardPanelProps {
    scorecard: ManagerScorecard;
    isLoading?: boolean;
}

const ManagerScorecardPanel: React.FC<ManagerScorecardPanelProps> = ({ scorecard, isLoading }) => {
    return (
        <Card className="bg-card border-border">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-foreground">
                    Manager Scorecard
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {SCORECARD_GROUPS.map((group) => (
                    <section key={group.title}>
                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.title}
                        </h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {group.cards.map((spec) =>
                                isLoading ? (
                                    <SkeletonCard key={spec.key} />
                                ) : (
                                    <ScorecardCard
                                        key={spec.key}
                                        spec={spec}
                                        scorecard={scorecard}
                                    />
                                ),
                            )}
                        </div>
                    </section>
                ))}

                <section>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Activity
                    </h4>
                    {isLoading ? (
                        <div className="grid grid-cols-3 gap-3">
                            <SkeletonCard />
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    ) : (
                        <ActivityBreakdown scorecard={scorecard} />
                    )}
                </section>
            </CardContent>
        </Card>
    );
};

export default ManagerScorecardPanel;
export { ManagerScorecardPanel };
