/**
 * CoverageHeatmap — hours × days, filled by GAP (required − assigned).
 *
 * Diverging scale: short is warm, over-rostered is cool, and "exactly staffed"
 * is a neutral gray midpoint. A sequential one-hue ramp would have rendered the
 * correct answer as an endpoint.
 *
 * A cell that is short AND unfillable from declared availability carries a ring
 * on top of the fill — shortfall is a different problem from gap and must not
 * be encoded as "more red".
 *
 * UI/UX structure strictly matches Team Mode (`TeamAvailabilityGrid`):
 *   - Expandable/Collapsible Badge Legend (`CollapsibleCoverageLegend`)
 *   - Glassmorphism table container with sticky headers
 *   - Full 100% width grid stretching in Day/3D/Week views
 *   - Rich interactive tooltips and hover micro-animations
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { HelpCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
    GAP_NEUTRAL,
    GAP_OVER_STEPS,
    GAP_SHORT_STEPS,
    gapFill,
} from './coverage-palette';
import type { CoverageBucket } from '../../model/team-availability.types';

interface Props {
    buckets: ReadonlyArray<CoverageBucket>;
    dates: ReadonlyArray<string>;
}

interface HoverState {
    bucket: CoverageBucket;
    x: number;
    y: number;
}

const TIME_COL = 80;

export const CoverageHeatmap: React.FC<Props> = ({ buckets, dates }) => {
    const { isDark } = useTheme();
    const [hover, setHover] = React.useState<HoverState | null>(null);

    const byKey = React.useMemo(() => {
        const map = new Map<string, CoverageBucket>();
        for (const b of buckets) map.set(`${b.date}|${b.hour}`, b);
        return map;
    }, [buckets]);

    // Fixed 24-hour day grid (00:00 to 23:00) with 1-hour steps
    const hours = React.useMemo(
        () => Array.from({ length: 24 }, (_, i) => i),
        [],
    );

    const showValues = dates.length <= 7;
    const stickyBg = isDark ? 'bg-[#141c2e]' : 'bg-slate-50';

    const showTooltip = (el: HTMLElement, bucket: CoverageBucket) => {
        const r = el.getBoundingClientRect();
        setHover({ bucket, x: r.left + r.width / 2, y: r.top - 8 });
    };

    if (buckets.length === 0) {
        return (
            <div className="py-12 text-center border rounded-2xl bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground">
                    No coverage data for this range.
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                    Select a date range with required or assigned shifts.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-2.5">
            <CollapsibleCoverageLegend isDark={isDark} />

            <div className="flex-1 min-h-0 overflow-auto scrollbar-none max-h-[calc(100vh-240px)] relative rounded-2xl border border-slate-200/80 dark:border-white/5 bg-background/50 shadow-inner">
                <table className="w-full border-separate border-spacing-0">
                    <caption className="sr-only">
                        Coverage gap by hour and date. Each cell states assigned vs required staffing.
                    </caption>
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                className={cn(
                                    'sticky left-0 top-0 z-30 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground py-3 px-2 border-b border-r border-slate-200/60 dark:border-white/5 shadow-xs',
                                    stickyBg,
                                )}
                                style={{ width: TIME_COL, minWidth: TIME_COL }}
                            >
                                TIME
                            </th>
                            {dates.map((d) => (
                                <th
                                    key={d}
                                    scope="col"
                                    className={cn(
                                        'sticky top-0 z-20 py-2.5 px-1 text-center border-b border-r border-slate-200/60 dark:border-white/5 shadow-xs transition-colors text-muted-foreground',
                                        stickyBg,
                                    )}
                                    style={{
                                        minWidth: dates.length <= 7 ? 60 : 32,
                                        width: dates.length <= 7 ? `${100 / dates.length}%` : 32,
                                    }}
                                >
                                    <span className="block text-[10px] font-black uppercase tracking-wider leading-none">
                                        {dates.length <= 7
                                            ? format(parseISO(d), 'EEE')
                                            : format(parseISO(d), 'EEE')}
                                    </span>
                                    <span className="block text-xs font-black tabular-nums mt-0.5 leading-none">
                                        {dates.length <= 7
                                            ? format(parseISO(d), 'd MMM')
                                            : format(parseISO(d), 'd')}
                                    </span>
                                    <span className="sr-only">
                                        {format(parseISO(d), 'EEEE d MMMM yyyy')}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {hours.map((hour, hIdx) => {
                            const isEven = hIdx % 2 === 0;
                            const rowBg = isEven
                                ? isDark ? 'bg-[#111827]/40' : 'bg-slate-50/50'
                                : isDark ? 'bg-transparent' : 'bg-white';

                            return (
                                <tr key={hour} className={cn('hover:bg-primary/5 transition-colors', rowBg)}>
                                    <th
                                        scope="row"
                                        className={cn(
                                            'sticky left-0 z-10 text-center px-2 py-2 border-b border-r border-slate-200/60 dark:border-white/5 text-[11px] font-black tabular-nums text-muted-foreground',
                                            stickyBg,
                                        )}
                                        style={{ width: TIME_COL, minWidth: TIME_COL }}
                                    >
                                        {String(hour).padStart(2, '0')}:00
                                    </th>

                                    {dates.map((date) => {
                                        const bucket = byKey.get(`${date}|${hour}`);
                                        if (!bucket) {
                                            return (
                                                <td
                                                    key={date}
                                                    className="border-b border-r border-slate-200/40 dark:border-white/5"
                                                    style={{
                                                        minWidth: dates.length <= 7 ? 60 : 32,
                                                        height: 38,
                                                    }}
                                                />
                                            );
                                        }

                                        const hasDemand = bucket.required > 0;
                                        const fill = gapFill(bucket.gap, hasDemand, isDark);
                                        const label = `${format(parseISO(date), 'EEE d MMM')} ${String(hour).padStart(2, '0')}:00 — required ${bucket.required}, available ${bucket.available}, assigned ${bucket.assigned}, gap ${bucket.gap}${bucket.shortfall > 0 ? `, ${bucket.shortfall} unfillable` : ''}`;

                                        return (
                                            <td
                                                key={date}
                                                className="border-b border-r border-slate-200/40 dark:border-white/5 p-1 text-center align-middle"
                                                style={{
                                                    minWidth: dates.length <= 7 ? 60 : 32,
                                                    height: 38,
                                                }}
                                            >
                                                <div
                                                    tabIndex={0}
                                                    role="button"
                                                    aria-label={label}
                                                    onMouseEnter={(e) => showTooltip(e.currentTarget, bucket)}
                                                    onMouseLeave={() => setHover(null)}
                                                    onFocus={(e) => showTooltip(e.currentTarget, bucket)}
                                                    onBlur={() => setHover(null)}
                                                    className="w-full h-full min-h-[30px] flex items-center justify-center rounded-xl transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:scale-[1.02] text-[10px] font-black tabular-nums shadow-xs"
                                                    style={{
                                                        backgroundColor: fill,
                                                        color:
                                                            hasDemand && Math.abs(bucket.gap) >= 3
                                                                ? '#ffffff'
                                                                : isDark
                                                                  ? '#e2e8f0'
                                                                  : '#334155',
                                                        boxShadow:
                                                            bucket.shortfall > 0
                                                                ? `inset 0 0 0 2px ${isDark ? '#ffffff' : '#090d16'}`
                                                                : undefined,
                                                    }}
                                                >
                                                    {showValues && hasDemand ? (
                                                        <span>
                                                            {bucket.assigned}/{bucket.required}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Custom Interactive Tooltip Card */}
            {hover && (
                <div
                    className="fixed z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full mb-1 animate-in fade-in-50 zoom-in-95 duration-100"
                    style={{ left: hover.x, top: hover.y }}
                >
                    <div className="bg-popover/95 backdrop-blur-md text-popover-foreground border border-border/80 rounded-2xl p-3 shadow-2xl min-w-[200px] space-y-1.5">
                        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5">
                            <p className="text-xs font-black text-foreground">
                                {format(parseISO(hover.bucket.date), 'EEE d MMM')} ·{' '}
                                {String(hover.bucket.hour).padStart(2, '0')}:00
                            </p>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-semibold tabular-nums">
                            <dt className="text-muted-foreground">Required</dt>
                            <dd className="text-right text-foreground font-black">{hover.bucket.required}</dd>
                            <dt className="text-muted-foreground">Available</dt>
                            <dd className="text-right text-foreground font-black">{hover.bucket.available}</dd>
                            <dt className="text-muted-foreground">Assigned</dt>
                            <dd className="text-right text-foreground font-black">{hover.bucket.assigned}</dd>
                            <dt className="text-muted-foreground">Gap</dt>
                            <dd className="text-right font-black">
                                {hover.bucket.gap > 0 ? (
                                    <span className="text-amber-500">{hover.bucket.gap} short</span>
                                ) : hover.bucket.gap < 0 ? (
                                    <span className="text-blue-400">{Math.abs(hover.bucket.gap)} over</span>
                                ) : (
                                    <span className="text-emerald-500">Balanced</span>
                                )}
                            </dd>
                            {hover.bucket.shortfall > 0 && (
                                <>
                                    <dt className="text-muted-foreground">Unfillable</dt>
                                    <dd className="text-right text-rose-500 font-black">{hover.bucket.shortfall}</dd>
                                </>
                            )}
                        </dl>
                    </div>
                </div>
            )}
        </div>
    );
};

const CollapsibleCoverageLegend: React.FC<{ isDark: boolean }> = ({ isDark }) => {
    const [isCollapsed, setIsCollapsed] = React.useState(true);

    return (
        <div
            className={cn(
                'rounded-2xl border border-slate-200/80 dark:border-white/5 bg-slate-50/50 dark:bg-[#141c2e]/60 backdrop-blur-md overflow-hidden transition-all duration-300 shrink-0',
            )}
        >
            <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-slate-100/60 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded-lg bg-primary/10 text-primary">
                        <HelpCircle className="h-3.5 w-3.5" />
                    </div>
                    <div className="text-left">
                        <p className="text-[10px] font-black tracking-wider uppercase text-foreground leading-none">
                            COVERAGE LEGEND
                        </p>
                        <p className="text-[9px] text-muted-foreground font-medium mt-0.5 leading-none">
                            GAP SCALE & UNFILLABLE REFERENCE
                        </p>
                    </div>
                </div>
                <ChevronDown
                    className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform duration-200',
                        !isCollapsed && 'rotate-180',
                    )}
                />
            </button>

            {!isCollapsed && (
                <div className="px-3.5 pb-3 pt-1 border-t border-slate-200/60 dark:border-white/5">
                    <Legend isDark={isDark} />
                </div>
            )}
        </div>
    );
};

const Legend: React.FC<{ isDark: boolean }> = ({ isDark }) => {
    const mode = isDark ? 'dark' : 'light';
    const over = [...GAP_OVER_STEPS[mode]].reverse();
    const short = GAP_SHORT_STEPS[mode];

    return (
        <div className="flex flex-wrap items-center gap-3 py-1">
            <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    Over
                </span>
                <div className="flex gap-[3px]">
                    {over.map((c) => (
                        <span key={c} className="h-3.5 w-3.5 rounded-md border border-white/10 shadow-2xs" style={{ backgroundColor: c }} />
                    ))}
                    <span
                        className="h-3.5 w-3.5 rounded-md border border-white/10 shadow-2xs"
                        style={{ backgroundColor: GAP_NEUTRAL[mode] }}
                    />
                    {short.map((c) => (
                        <span key={c} className="h-3.5 w-3.5 rounded-md border border-white/10 shadow-2xs" style={{ backgroundColor: c }} />
                    ))}
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    Short
                </span>
            </div>

            <div className="h-4 w-px bg-border/40 shrink-0" />

            <div className="flex items-center gap-2">
                <span
                    className="h-3.5 w-3.5 rounded-md shadow-2xs border border-white/20"
                    style={{
                        backgroundColor: GAP_NEUTRAL[mode],
                        boxShadow: `inset 0 0 0 2px ${isDark ? '#ffffff' : '#090d16'}`,
                    }}
                />
                <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                    Unfillable
                </span>
            </div>
        </div>
    );
};

export default CoverageHeatmap;
