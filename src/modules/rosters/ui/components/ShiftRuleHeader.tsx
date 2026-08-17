import React, { useMemo } from 'react';
import { cn } from '@/modules/core/lib/utils';
import {
    getTimeRule,
    getLiveRuleBadges,
    getPayrollRuleBadges,
    isShiftAssigned,
    type ShiftDotInput,
    type ShiftRuleBadge,
} from '../../domain/shift-ui';
import type { ShiftStateDisplay } from '../../domain/shift-fsm';

export interface ShiftRuleHeaderProps {
    /** Minimal schedule + attendance fields needed to derive both rules. */
    shift: ShiftDotInput;
    /** `compact` (dense grids) tightens type/padding; `detailed` is roomier. */
    variant?: 'compact' | 'detailed';
    className?: string;
    /**
     * State descriptor for the leading "State" row. When provided, the card
     * shows a consistent State / Time Rules / Live Rules block. Omit to keep the
     * legacy two-row (Time / Live) layout.
     */
    state?: ShiftStateDisplay | null;
    /**
     * Whether the shift has an assigned worker. Unassigned shifts can never
     * accrue attendance, so the Live Rules row is suppressed entirely when this
     * is false. Defaults to deriving from the shift's assignment fields.
     */
    assigned?: boolean;
    /** Render the rows inside a quiet, tinted footer "band" (job-card style). */
    band?: boolean;
    /** For unassigned shifts: 'hide' drops the Live Rules row (default); 'na' keeps the row and shows "N/A". */
    liveRulesUnassigned?: 'hide' | 'na';
    /** When true, adds a "Payroll Rules" row showing the billable-window badges.
     *  Opt-in so planner/offer cards (where billable is always empty) stay clean. */
    showPayrollRules?: boolean;
}

/** A single labelled row, styled per variant — shared by State / Time / Live. */
const RuleRow: React.FC<{ label: string; variant: 'compact' | 'detailed'; children?: React.ReactNode }> = ({ label, variant, children }) => {
    if (variant === 'detailed') {
        return (
            <div className="flex items-center justify-between gap-2 py-1.5 border-b border-foreground/[0.04] last:border-0">
                <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                    {label}
                </span>
                {children}
            </div>
        );
    }
    return (
        <div className="flex items-center justify-between gap-2 text-[9px] leading-none">
            <span className="font-black text-muted-foreground/40 uppercase tracking-widest shrink-0">
                {label}
            </span>
            {children}
        </div>
    );
};

/** Render the arrival + departure halves of the Live Rules model side by side. */
const LiveBadges: React.FC<{ badges: { arrival: ShiftRuleBadge | null; departure: ShiftRuleBadge | null }; size: 'compact' | 'detailed' }> = ({ badges, size }) => {
    const { arrival, departure } = badges;
    if (!arrival && !departure) return null;
    const textCls = size === 'detailed'
        ? 'tabular-nums tracking-tight font-black font-mono text-[12px] uppercase'
        : 'font-black font-mono tracking-tight text-[10px] uppercase leading-none';
    return (
        <div className="flex items-center gap-1.5 justify-end flex-wrap">
            {arrival && <span className={textCls} style={{ color: arrival.color }}>{arrival.label}</span>}
            {arrival && departure && <span className="text-muted-foreground/30">·</span>}
            {departure && <span className={textCls} style={{ color: departure.color }}>{departure.label}</span>}
        </div>
    );
};

const ShiftRuleHeaderImpl: React.FC<ShiftRuleHeaderProps> = ({ shift, variant = 'compact', className, state, assigned, band, liveRulesUnassigned = 'hide', showPayrollRules }) => {
    const time = useMemo(() => getTimeRule(shift), [
        shift.start_at, shift.end_at, shift.start_time, shift.end_time, shift.shift_date,
    ]);
    const live = useMemo(() => getLiveRuleBadges(shift), [
        shift.start_at, shift.end_at, shift.start_time, shift.end_time, shift.shift_date,
        shift.actual_start, shift.actual_end, shift.attendance_status, shift.attendance_note,
        shift.adjusted_start, shift.adjusted_end,
    ]);
    const payroll = useMemo(
        () => (showPayrollRules ? getPayrollRuleBadges(shift) : { arrival: null, departure: null }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [showPayrollRules, shift.start_at, shift.end_at, shift.start_time, shift.end_time,
         shift.shift_date, shift.adjusted_start, shift.adjusted_end, shift.actual_start, shift.actual_end],
    );
    const showPayroll = showPayrollRules && !!(payroll.arrival || payroll.departure);

    const isDraft = shift.lifecycle_status === 'Draft';

    // Unassigned shifts have no attendance → no Live Rules row at all. The
    // explicit prop wins; otherwise defer to the shared domain helper so this
    // component and the badge derivations can't drift apart on what "assigned"
    // means. (The derivations now return empty for unassigned shifts too, so
    // this is belt-and-braces for callers that pass `assigned` explicitly.)
    const isAssigned = assigned !== undefined ? assigned : isShiftAssigned(shift);

    const showLive = isDraft || (isAssigned && !!(live.arrival || live.departure));

    // Band mode is a self-contained tinted footer block. It ignores compact/
    // detailed variant styling and renders the State / Time Rules / Live Rules
    // rows as a quiet job-card style band.
    if (band) {
        // Unassigned shifts: 'hide' omits the Live Rules row entirely, 'na'
        // keeps the row but shows a muted "N/A" with no status dot.
        const showLiveBand = isDraft || (isAssigned ? !!(live.arrival || live.departure) : liveRulesUnassigned === 'na');
        if (!state && !time && !showLiveBand) return null;

        const labelCls = 'text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 shrink-0';
        const valueBandCls = 'text-xs font-semibold text-right truncate min-w-0';

        return (
            <div className={cn('mt-3 rounded-xl border-t border-slate-200/70 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04] px-3 py-2 space-y-1', className)}>
                {state && (
                    <div className="flex justify-between items-center gap-2">
                        <span className={labelCls}>State</span>
                        <span className={valueBandCls} style={{ color: state.color }}>
                            {state.id} · {state.label}
                        </span>
                    </div>
                )}
                <div className="flex justify-between items-center gap-2">
                    <span className={labelCls}>Time Rules</span>
                    <span className={valueBandCls}>
                        {time && (
                            <span className="inline-flex items-center gap-1.5 justify-end">
                                <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ background: time.color }} />
                                <span style={{ color: time.color }}>{time.label}</span>
                            </span>
                        )}
                    </span>
                </div>
                {showLiveBand && (
                    <div className="flex justify-between items-center gap-2">
                        <span className={labelCls}>Live Rules</span>
                        <span className={valueBandCls}>
                            {isDraft ? (
                                <span className="text-slate-400 dark:text-slate-500 font-semibold text-xs uppercase">N/A</span>
                            ) : isAssigned ? (
                                <span className="inline-flex items-center gap-1.5 justify-end">
                                    {live.arrival && (
                                        <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ background: live.arrival.color }} />
                                    )}
                                    {live.arrival && (
                                        <span style={{ color: live.arrival.color }}>{live.arrival.label}</span>
                                    )}
                                    {live.arrival && live.departure && <span className="text-muted-foreground/30">·</span>}
                                    {live.departure && (
                                        <span style={{ color: live.departure.color }}>{live.departure.label}</span>
                                    )}
                                </span>
                            ) : (
                                <span className="text-slate-400 dark:text-slate-500 font-semibold text-xs uppercase">N/A</span>
                            )}
                        </span>
                    </div>
                )}
                {showPayroll && (
                    <div className="flex justify-between items-center gap-2">
                        <span className={labelCls}>Payroll Rules</span>
                        <span className={valueBandCls}>
                            <span className="inline-flex items-center gap-1.5 justify-end">
                                {payroll.arrival && (
                                    <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ background: payroll.arrival.color }} />
                                )}
                                {payroll.arrival && (
                                    <span style={{ color: payroll.arrival.color }}>{payroll.arrival.label}</span>
                                )}
                                {payroll.arrival && payroll.departure && <span className="text-muted-foreground/30">·</span>}
                                {payroll.departure && (
                                    <span style={{ color: payroll.departure.color }}>{payroll.departure.label}</span>
                                )}
                            </span>
                        </span>
                    </div>
                )}
            </div>
        );
    }

    if (!state && !time && !showLive) return null;

    const isDetailed = variant === 'detailed';
    const valueCls = isDetailed
        ? 'tabular-nums tracking-tight font-black font-mono text-[12px] uppercase text-right truncate min-w-0'
        : 'font-black font-mono tracking-tight text-[10px] uppercase text-right leading-none truncate min-w-0';

    return (
        <div className={cn(isDetailed ? 'flex flex-col w-full' : 'flex flex-col gap-1.5 w-full', className)}>
            {state && (
                <RuleRow label="State" variant={variant}>
                    <span className={valueCls} style={{ color: state.color }}>
                        {state.id} · {state.label}
                    </span>
                </RuleRow>
            )}
            <RuleRow label="Time Rules" variant={variant}>
                {time && <span className={valueCls} style={{ color: time.color }}>{time.label}</span>}
            </RuleRow>
            {showLive && (
                <RuleRow label="Live Rules" variant={variant}>
                    {isDraft ? (
                        <span className={cn("font-semibold uppercase text-slate-400 dark:text-slate-500", isDetailed ? "text-xs" : "text-[10px]")}>
                            N/A
                        </span>
                    ) : (
                        <LiveBadges badges={live} size={isDetailed ? 'detailed' : 'compact'} />
                    )}
                </RuleRow>
            )}
            {showPayroll && (
                <RuleRow label="Payroll Rules" variant={variant}>
                    <LiveBadges badges={payroll} size={isDetailed ? 'detailed' : 'compact'} />
                </RuleRow>
            )}
        </div>
    );
};

export const ShiftRuleHeader = React.memo(ShiftRuleHeaderImpl);

export default ShiftRuleHeader;
