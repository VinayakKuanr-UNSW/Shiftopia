import React from 'react';
import { Scale, Zap, ArrowRight, Moon, CalendarDays, CalendarClock, Clock, Timer } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { FatigueBand } from '@/modules/rosters/domain/projections/utils/fatigue';
import type { FairnessImpact, FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';

/**
 * Per-bidder "what-if" ledger preview shown in the bid-review panel: if this
 * bidder were awarded the shift, how would their FAIRNESS standing (weekend /
 * night / PH / hours load vs the team average) and 7-day FATIGUE move? Purely
 * presentational — the numbers come from `projectFairnessImpact` +
 * `calculateFatigueWithRecovery`. Read-only; nothing is committed.
 */

export interface BidLedgerImpactData {
    fatigue: { current: number; projected: number; band: FatigueBand } | null;
    /** null = no team baseline available (org has no fairness history yet). */
    fairness: FairnessImpact | null;
}

const BAND: Record<FatigueBand, { label: string; text: string; chip: string }> = {
    ok:       { label: 'OK',       text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
    risk:     { label: 'Risk',     text: 'text-amber-600 dark:text-amber-400',     chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
    critical: { label: 'Critical', text: 'text-rose-600 dark:text-rose-400',       chip: 'bg-rose-500/20 text-rose-600 dark:text-rose-300' },
};

const METRIC: Partial<Record<FairnessMetric, { label: string; Icon: React.ComponentType<{ className?: string }> }>> = {
    saturday_shifts:       { label: 'Saturday',      Icon: CalendarDays },
    sunday_shifts:         { label: 'Sunday',        Icon: CalendarDays },
    night_shifts:          { label: 'Night',         Icon: Moon },
    public_holiday_shifts: { label: 'Public holiday', Icon: CalendarClock },
    total_hours:           { label: 'Hours (window)', Icon: Clock },
    overtime_minutes:      { label: 'Overtime',      Icon: Timer },
};

/**
 * Order metrics so the count buckets read first, then hours/OT.
 *
 * Saturday and Sunday are listed separately because the ledger weights them
 * separately (EBA cl 41) — showing a merged "Weekend" row would hide the fact
 * that a Sunday moves the bidder's standing twice as far as a Saturday.
 */
const METRIC_ORDER: FairnessMetric[] = [
    'saturday_shifts', 'sunday_shifts', 'night_shifts', 'public_holiday_shifts',
    'total_hours', 'overtime_minutes',
];

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

/** A fairness debt row. Positive after-debt = now above the team's fair share. */
const FairnessRow: React.FC<{ metric: FairnessMetric; impact: FairnessImpact }> = ({ metric, impact }) => {
    const meta = METRIC[metric];
    if (!meta) return null;
    const before = impact.before[metric];
    const after = impact.after[metric];
    const Icon = meta.Icon;
    const aboveShare = after.debt > 0.05;
    const tone = aboveShare ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

    // Hours & OT: show the delta as hours rather than a raw count.
    const isHours = metric === 'total_hours';
    const isOt = metric === 'overtime_minutes';
    const valueText = isHours
        ? `${before.value.toFixed(1)}h → ${after.value.toFixed(1)}h`
        : isOt
            ? `+${((after.value - before.value) / 60).toFixed(1)}h OT`
            : `${before.value} → ${after.value}`;

    return (
        <div className="flex items-center gap-2 text-[11px]">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="text-muted-foreground/80 w-24 shrink-0">{meta.label}</span>
            <span className="font-mono tabular-nums text-foreground">{valueText}</span>
            <span className="flex-1" />
            <span className={cn('font-mono tabular-nums', tone)} title="fairness debt vs team average (before → after)">
                {signed(before.debt)} → {signed(after.debt)}
            </span>
            <span className={cn('text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0',
                aboveShare ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300')}>
                {aboveShare ? 'above share' : 'below share'}
            </span>
        </div>
    );
};

/** One-line human summary in the WhyThisPerson voice. */
function fairnessSummary(impact: FairnessImpact): string {
    const worsened = impact.changed.filter(m => m !== 'total_hours' && m !== 'overtime_minutes' && impact.after[m].debt > 0.5);
    if (worsened.length > 0) {
        const names = worsened.map(m => METRIC[m]?.label.toLowerCase()).filter(Boolean).join(' & ');
        return `Pushes them further above the team's share of ${names} work.`;
    }
    return "Helps balance the roster — they're still at or below the team's fair share.";
}

export const BidLedgerImpact: React.FC<{ impact: BidLedgerImpactData | null; className?: string }> = ({ impact, className }) => {
    if (!impact || (!impact.fatigue && !impact.fairness)) return null;
    const { fatigue, fairness } = impact;
    const changed = fairness ? METRIC_ORDER.filter(m => fairness.changed.includes(m)) : [];

    return (
        <div className={cn('rounded-xl border border-border/40 bg-muted/10 p-3 flex flex-col gap-3', className)}>
            <div className="flex items-center gap-2">
                <Scale className="h-3.5 w-3.5 text-primary/70" />
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/80">
                    Ledger impact if assigned
                </span>
            </div>

            {/* Fatigue */}
            {fatigue && (
                <div className="flex items-center gap-2 text-[11px]">
                    <Zap className={cn('h-3 w-3 shrink-0', BAND[fatigue.band].text)} />
                    <span className="text-muted-foreground/80 w-24 shrink-0">Fatigue (7-day)</span>
                    <span className="font-mono tabular-nums text-foreground flex items-center gap-1">
                        {fatigue.current.toFixed(1)}
                        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                        <span className={BAND[fatigue.band].text}>{fatigue.projected.toFixed(1)}</span>
                    </span>
                    <span className="text-muted-foreground/50 font-mono tabular-nums">({signed(fatigue.projected - fatigue.current)})</span>
                    <span className="flex-1" />
                    <span className={cn('text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full', BAND[fatigue.band].chip)}>
                        {BAND[fatigue.band].label}
                    </span>
                </div>
            )}

            {/* Fairness */}
            {fairness && changed.length > 0 ? (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
                    {changed.map(m => <FairnessRow key={m} metric={m} impact={fairness} />)}
                    <p className="text-[10px] leading-snug text-muted-foreground/70 italic pt-0.5">{fairnessSummary(fairness)}</p>
                </div>
            ) : fairness ? (
                <p className="text-[10px] text-muted-foreground/60 italic pt-1 border-t border-border/30">
                    No change to weekend / night / holiday / hours balance.
                </p>
            ) : (
                <p className="text-[10px] text-muted-foreground/50 italic pt-1 border-t border-border/30">
                    No team fairness baseline yet — fatigue shown above.
                </p>
            )}
        </div>
    );
};
