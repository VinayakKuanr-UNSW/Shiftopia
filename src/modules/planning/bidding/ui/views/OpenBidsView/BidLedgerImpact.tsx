import React from 'react';
import { Scale, Zap, ArrowRight, Moon, CalendarDays, CalendarClock, Clock } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { FatigueBand } from '@/modules/rosters/domain/projections/utils/fatigue';
import type { FairnessImpact, FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';

/**
 * Per-bidder "what-if" ledger preview shown in the bid-review panel: if this
 * bidder were awarded the shift, how would their FAIRNESS standing (weekend /
 * night / PH / total hours against their opportunity-adjusted fair share) and
 * 7-day FATIGUE move? Purely presentational — the numbers come from
 * `projectFairnessImpact` + `calculateFatigueWithRecovery`. Read-only.
 */

export interface BidLedgerImpactData {
    fatigue: { current: number; projected: number; band: FatigueBand } | null;
    /** null = not shown: a non-casual shift, or the standing could not be read. */
    fairness: FairnessImpact | null;
    /** Fairness is casual-only; false on a Full-Time / Part-Time shift. */
    casualShift: boolean;
    /** The ledger read failed (or there was no organization to read it for). */
    unavailable: boolean;
    /** Bidders the shift's hours are shared among in the what-if. */
    poolSize: number;
}

/** Below this the standing is shown as history-in-progress, not a verdict. */
const CONFIDENT = 0.5;

const BAND: Record<FatigueBand, { label: string; text: string; chip: string }> = {
    ok:       { label: 'OK',       text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
    risk:     { label: 'Risk',     text: 'text-amber-600 dark:text-amber-400',     chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
    critical: { label: 'Critical', text: 'text-rose-600 dark:text-rose-400',       chip: 'bg-rose-500/20 text-rose-600 dark:text-rose-300' },
};

const METRIC: Partial<Record<FairnessMetric, { label: string; Icon: React.ComponentType<{ className?: string }> }>> = {
    saturday_hours:       { label: 'Saturday',       Icon: CalendarDays },
    sunday_hours:         { label: 'Sunday',         Icon: CalendarDays },
    night_hours:          { label: 'Night',          Icon: Moon },
    public_holiday_hours: { label: 'Public holiday', Icon: CalendarClock },
    total_hours:          { label: 'Hours (window)', Icon: Clock },
};

/**
 * Unsociable buckets first, then total hours. Overtime never appears: awarding
 * a shift does not bill beyond its roster.
 *
 * Saturday and Sunday are listed separately because the ledger weights them
 * separately (EBA cl 41) — showing a merged "Weekend" row would hide the fact
 * that a Sunday moves the bidder's standing twice as far as a Saturday.
 */
const METRIC_ORDER: FairnessMetric[] = [
    'saturday_hours', 'sunday_hours', 'night_hours', 'public_holiday_hours', 'total_hours',
];

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

/** A fairness debt row, in hours. Positive after-debt = now above their fair share. */
const FairnessRow: React.FC<{ metric: FairnessMetric; impact: FairnessImpact }> = ({ metric, impact }) => {
    const meta = METRIC[metric];
    const before = impact.before[metric];
    const after = impact.after[metric];
    if (!meta || !before || !after) return null;
    const Icon = meta.Icon;
    const aboveShare = after.debt > 0.05;
    const building = after.confidence < CONFIDENT;
    const tone = building
        ? 'text-muted-foreground'
        : aboveShare ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
    const onRecord = before.opportunities;

    return (
        <div className="flex items-center gap-2 text-[11px]">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="text-muted-foreground/80 w-24 shrink-0">{meta.label}</span>
            <span className="font-mono tabular-nums text-foreground">{`${before.actual.toFixed(1)}h → ${after.actual.toFixed(1)}h`}</span>
            <span className="flex-1" />
            <span className={cn('font-mono tabular-nums', tone)}>
                {signed(before.debt)} → {signed(after.debt)}
            </span>
            {building ? (
                <span className="text-[11px] italic text-muted-foreground/60 shrink-0">
                    building history · {onRecord === 0 ? 'no shifts yet' : `${onRecord} ${onRecord === 1 ? 'shift' : 'shifts'}`}
                </span>
            ) : (
                <span className={cn('text-[11px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0',
                    aboveShare ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300')}>
                    {aboveShare ? 'above share' : 'below share'}
                </span>
            )}
        </div>
    );
};

/** One-line human summary in the WhyThisPerson voice. Thin records are not judged. */
function fairnessSummary(impact: FairnessImpact): string {
    const confident = impact.changed.filter(m => (impact.after[m]?.confidence ?? 0) >= CONFIDENT);
    if (confident.length === 0) return 'Not enough history yet to judge their fair share.';
    const debtOf = (m: FairnessMetric) => ({ before: impact.before[m]?.debt ?? 0, after: impact.after[m]?.debt ?? 0 });
    const worsened = confident.filter(m => {
        const d = debtOf(m);
        return m !== 'total_hours' && d.after > 0.5 && d.after - d.before > 0.05;
    });
    if (worsened.length > 0) {
        const names = worsened.map(m => METRIC[m]?.label.toLowerCase()).filter(Boolean).join(' & ');
        return `Pushes them further above their fair share of ${names} work.`;
    }
    if (confident.some(m => debtOf(m).after > 0.5)) {
        return "Leaves them where they are — still above their fair share, but this shift doesn't add to it.";
    }
    return "Helps balance the roster — they're still at or below their fair share.";
}

export const BidLedgerImpact: React.FC<{ impact: BidLedgerImpactData | null; className?: string }> = ({ impact, className }) => {
    if (!impact || (!impact.fatigue && !impact.fairness)) return null;
    const { fatigue, fairness, casualShift, unavailable, poolSize } = impact;
    const changed = fairness ? METRIC_ORDER.filter(m => fairness.changed.includes(m)) : [];

    return (
        <div className={cn('rounded-xl border border-border/40 bg-muted/10 p-3 flex flex-col gap-3', className)}>
            <div className="flex items-center gap-2">
                <Scale className="h-3.5 w-3.5 text-primary/70" />
                <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">
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
                    <span className={cn('text-[11px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full', BAND[fatigue.band].chip)}>
                        {BAND[fatigue.band].label}
                    </span>
                </div>
            )}

            {/* Fairness */}
            {fairness && changed.length > 0 ? (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
                    {changed.map(m => <FairnessRow key={m} metric={m} impact={fairness} />)}
                    <p className="text-[11px] leading-snug text-muted-foreground/60">
                        Hours above (+) or below (−) their fair share, before → after, if this shift is shared
                        among its {poolSize} {poolSize === 1 ? 'bidder' : 'bidders'}.
                    </p>
                    <p className="text-[11px] leading-snug text-muted-foreground/70 italic pt-0.5">{fairnessSummary(fairness)}</p>
                </div>
            ) : fairness ? (
                <p className="text-[11px] text-muted-foreground/60 italic pt-1 border-t border-border/30">
                    No change to weekend / night / holiday / hours balance.
                </p>
            ) : (
                <p className="text-[11px] text-muted-foreground/50 italic pt-1 border-t border-border/30">
                    {!casualShift
                        ? 'Fairness applies to casual shifts only.'
                        : unavailable
                            ? "Fairness standing couldn't be loaded."
                            : 'No fairness history yet — it builds from approved casual shifts.'}
                </p>
            )}
        </div>
    );
};
