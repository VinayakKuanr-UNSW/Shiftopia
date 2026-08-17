/**
 * TeamAvailabilityGrid — people × days, one cell per (member, day).
 *
 * Five states, each carrying a glyph as well as a fill so identity is never
 * colour-alone (the light-mode aqua sits at 2.75:1, which obligates relief).
 * `unset` is drawn as a dashed outline with no fill — an absence rendered as an
 * absence, which also survives any colour-vision deficiency.
 *
 * Density follows the span. At 3-day and week widths there is room to print the
 * declared window inside the cell, which removes a hover for the two views a
 * manager actually plans in; at month width only the glyph fits.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    GraduationCap,
    HelpCircle,
    ShieldAlert,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { isWeekendISO } from '../../domain/team-coverage';
import type {
    EmpComp,
    EmployeeHours,
    WeekColumn,
    WeekComp,
} from '../../domain/hours-compliance';
import {
    FAIRNESS_BAND_LABEL,
    FATIGUE_BAND_LABEL,
    UTILIZATION_STATUS_LABEL,
    fairnessBand,
    unsociableDebt,
    weekUtilization,
    type DayFairnessContribution,
    type EmployeeFatigue,
    type FairnessStanding,
    type FatigueBand,
    type UtilizationStatus,
} from '../../domain/team-metrics';
import { hoursFill, severityStyle, stateSoft, type ComplianceSeverity } from './coverage-palette';
import {
    TEAM_DAY_STATE_LABELS,
    TEAM_DAY_STATE_ORDER,
    type TeamDayCell,
    type TeamMember,
} from '../../model/team-availability.types';

import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';

export type GridDensity = 'comfortable' | 'compact';

const MemberContractsPopover: React.FC<{ member: TeamMember }> = ({ member }) => {
    const [open, setOpen] = React.useState(false);
    const contracts = member.contracts ?? [];
    const extraCount = contracts.length - 1;

    if (extraCount <= 0) return null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                    }}
                    onMouseEnter={() => setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                    className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ml-1"
                    aria-label={`View ${extraCount} additional contracts held by ${member.fullName}`}
                >
                    +{extraCount} more
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="right"
                align="start"
                className="w-64 p-3 rounded-2xl border border-primary/20 shadow-2xl bg-popover/95 backdrop-blur-xl animate-in fade-in-50 zoom-in-95 duration-100 z-50 pointer-events-auto"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                            All Contracts ({contracts.length})
                        </span>
                        <span className="text-xs font-bold text-foreground truncate max-w-[120px]">
                            {member.fullName}
                        </span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {contracts.map((c, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-muted/30 border border-border/20 text-xs"
                            >
                                <span className="font-bold text-foreground truncate">
                                    {c.roleName ?? 'No role'}
                                </span>
                                {c.employmentStatus && (
                                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-background text-muted-foreground border border-border/30 shrink-0">
                                        {c.employmentStatus}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

/**
 * What each cell says. The grid, the rows, the filters and the pagination are
 * the same in all three — only the contents of a cell change, which is what
 * makes hours and availability readable against each other rather than in two
 * separate places.
 */
export type CellMode =
    | 'availability'
    | 'hours'
    | 'compliance'
    | 'fatigue'
    | 'utilization'
    | 'fairness';

/** Fatigue bands map onto the reserved status ramp; no new hues invented. */
const FATIGUE_SEVERITY: Record<FatigueBand, ComplianceSeverity> = {
    ok: 'ok',
    risk: 'warning',
    critical: 'violation',
};

const UTILIZATION_SEVERITY: Record<UtilizationStatus, ComplianceSeverity> = {
    none: 'ok',
    under: 'warning',
    ideal: 'ok',
    over: 'warning',
    critical: 'violation',
};

interface Props {
    members: ReadonlyArray<TeamMember>;
    dates: ReadonlyArray<string>;
    cells: Map<string, Map<string, TeamDayCell>>;
    /** Derived from the span by the page; comfortable prints window text. */
    density?: GridDensity;
    onSelectMember?: (member: TeamMember) => void;
    /** Defaults to the availability view this grid started as. */
    cellMode?: CellMode;
    /** Empty (the default) renders no week totals and no status column. */
    weekColumns?: ReadonlyArray<WeekColumn>;
    hoursByProfile?: Map<string, EmployeeHours>;
    complianceByProfile?: Map<string, EmpComp>;
    /** Profile ids on a work-limited visa. */
    restrictedWorkLimits?: ReadonlySet<string>;
    fatigueByProfile?: Map<string, EmployeeFatigue>;
    /** profileId -> date -> that day's contribution to the fairness ledger. */
    fairnessContribution?: Map<string, Map<string, DayFairnessContribution>>;
    /** profileId -> their 91-day standing against the cohort. */
    fairnessStanding?: Map<string, FairnessStanding>;
}

const NAME_COL = 220;
const WEEK_COL = 78;
const STATUS_COL = 152;
const CELL_W: Record<GridDensity, number> = { comfortable: 128, compact: 30 };
const ROW_H: Record<GridDensity, number> = { comfortable: 46, compact: 32 };

/** `7.5` not `7.50`, `8` not `8.0`. */
const fmtHours = (h: number) => parseFloat(h.toFixed(1)).toString();

const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
};

const StateLegend: React.FC<{ isDark: boolean }> = ({ isDark }) => (
    // Reads from the same tokens the cells do, so the key can never drift from
    // what it is a key for.
    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
        {TEAM_DAY_STATE_ORDER.map((state) => {
            const soft = stateSoft(state, isDark);
            return (
                <span
                    key={state}
                    className={cn(
                        'flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs text-foreground',
                        soft.dashed && 'border-dashed',
                    )}
                    style={{
                        backgroundColor: soft.bg,
                        borderColor: soft.border ?? '#89878152',
                    }}
                >
                    {/* Same glyph the cells carry — the dot alone would make the
                        legend a colour key for an encoding that is not colour. */}
                    {TEAM_DAY_STATE_LABELS[state]}
                </span>
            );
        })}
    </div>
);

const CollapsibleBadgeLegend: React.FC<{ isDark: boolean }> = ({ isDark }) => {
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
                            BADGE LEGEND
                        </p>
                        <p className="text-[9px] text-muted-foreground font-medium mt-0.5 leading-none">
                            INDICATOR & STATUS REFERENCE
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
                    <StateLegend isDark={isDark} />
                </div>
            )}
        </div>
    );
};

/**
 * The worst fatigue reached inside one week column.
 *
 * Max, not mean: fatigue is a risk reading, and averaging a critical Saturday
 * with four quiet weekdays reports a comfortable week that contained a
 * dangerous day.
 */
function peakFatigueInWeek(
    fatigue: EmployeeFatigue | undefined,
    week: WeekColumn,
): { score: number; band: FatigueBand } | null {
    if (!fatigue) return null;
    let best: { score: number; band: FatigueBand } | null = null;
    for (const date of week.visibleDates) {
        const day = fatigue.byDate.get(date);
        if (day && (!best || day.score > best.score)) best = { score: day.score, band: day.band };
    }
    return best;
}

/** The severity to paint one (member, day) cell in compliance mode. */
function daySeverity(comp: EmpComp | undefined, date: string): ComplianceSeverity {
    if (comp?.dailyViolations.has(date)) return 'violation';
    if (comp?.dailyWarnings.has(date)) return 'warning';
    return 'ok';
}

const SEVERITY_ICON = {
    violation: ShieldAlert,
    warning: AlertTriangle,
    ok: CheckCircle2,
} as const;

const SEVERITY_LABEL = {
    violation: 'Violation',
    warning: 'Near limit',
    ok: 'OK',
} as const;

/**
 * The ISO week total.
 *
 * The number is the TRUE full-week figure even when the range only shows part
 * of that week — the shift read spans whole ISO weeks precisely so it can be.
 * `isPartial` is therefore not a caveat about accuracy but the opposite: a
 * warning that this number is deliberately NOT the sum of the cells beside it.
 */
const WeekTotalCell: React.FC<{
    week: WeekColumn;
    hours: number;
    comp: WeekComp | undefined;
    memberName: string;
    isDark: boolean;
    rowH: number;
    /** Utilization mode reports the PERCENTAGE here — this is its real grain. */
    cellMode?: CellMode;
    contractedWeeklyHours?: number;
    /** Peak fatigue reached in this week, for the fatigue mode. */
    weekPeakFatigue?: { score: number; band: FatigueBand } | null;
}> = ({ week, hours, comp, memberName, isDark, rowH, cellMode, contractedWeeklyHours, weekPeakFatigue }) => {
    const util = cellMode === 'utilization' ? weekUtilization(hours, contractedWeeklyHours) : null;

    // The week cell reports whichever metric the mode is about. Compliance
    // severity still tints it in every other mode, since a breach does not stop
    // being a breach because you are looking at fatigue.
    const severity =
        util !== null
            ? UTILIZATION_SEVERITY[util.status]
            : cellMode === 'fatigue' && weekPeakFatigue
              ? FATIGUE_SEVERITY[weekPeakFatigue.band]
              : (comp?.worstV8Severity ?? 'ok');
    const style = severityStyle(severity, isDark);
    const windows = cellMode === 'utilization' || cellMode === 'fatigue' ? [] : (comp?.windows ?? []);

    const primary =
        util !== null
            ? util.status === 'none'
                ? '—'
                : `${Math.round(util.pct)}%`
            : cellMode === 'fatigue'
              ? (weekPeakFatigue ? fmtHours(weekPeakFatigue.score) : '—')
              : hours > 0
                ? fmtHours(hours)
                : '—';

    const acc = [
        `${memberName}, week ${week.label}: ${hours > 0 ? `${fmtHours(hours)} hours` : 'no hours'}`,
        util !== null
            ? util.status === 'none'
                ? 'no contracted hours to measure utilization against'
                : `${Math.round(util.pct)} percent of contract, ${UTILIZATION_STATUS_LABEL[util.status]}`
            : null,
        cellMode === 'fatigue' && weekPeakFatigue
            ? `peak fatigue ${weekPeakFatigue.score}, ${FATIGUE_BAND_LABEL[weekPeakFatigue.band]}`
            : null,
        week.isPartial ? `full-week total, ${week.visibleDates.length} of 7 days shown` : null,
        ...windows.map((w) => `${w.weeks}-week window ${w.hours} of ${w.limit} hours, ${SEVERITY_LABEL[w.severity]}`),
    ]
        .filter(Boolean)
        .join('. ');

    return (
        <td
            className={cn(
                'border-b border-r border-l-2 border-slate-200/40 dark:border-white/5 p-1 text-center align-middle',
                week.isPartial ? 'border-l-primary/50 border-dashed' : 'border-l-primary/25',
            )}
            style={{ minWidth: WEEK_COL, width: WEEK_COL, height: rowH }}
        >
            <div
                tabIndex={0}
                role="img"
                aria-label={acc}
                className="w-full h-full flex flex-col items-center justify-center gap-0.5 rounded-xl border px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{
                    backgroundColor: severity === 'ok' ? 'transparent' : style.bg,
                    borderColor: severity === 'ok' ? '#89878133' : style.border,
                }}
            >
                {windows.length > 0 && (
                    <div className="flex items-center justify-center gap-0.5 flex-wrap">
                        {windows.map((w) => {
                            const ws = severityStyle(w.severity, isDark);
                            return (
                                <span
                                    key={w.weeks}
                                    className="text-[7px] font-black px-1 py-px rounded leading-none border"
                                    style={{ color: ws.mark, borderColor: ws.border, backgroundColor: ws.bg }}
                                >
                                    {w.weeks}W
                                </span>
                            );
                        })}
                    </div>
                )}
                <span className="text-[11px] font-black tabular-nums leading-none text-foreground">
                    {primary}
                </span>
            </div>
        </td>
    );
};

/**
 * Row summary. Icon + written status — the fill is never the only signal.
 *
 * Mode-aware, because two of the six metrics have no per-day value and this is
 * where they are actually reported: fairness is a 91-day standing against the
 * cohort, and utilization is a period figure.
 */
const RowSummary: React.FC<{
    comp: EmpComp | undefined;
    isDark: boolean;
    cellMode: CellMode;
    fatigue?: EmployeeFatigue;
    standing?: FairnessStanding;
    periodHours: number;
    contractedWeeklyHours?: number;
    weeksOnScreen: number;
}> = ({ comp, isDark, cellMode, fatigue, standing, periodHours, contractedWeeklyHours, weeksOnScreen }) => {
    let severity: ComplianceSeverity;
    let title: string;
    let detail: string;

    if (cellMode === 'fatigue') {
        const band = fatigue?.worstBand ?? 'ok';
        severity = FATIGUE_SEVERITY[band];
        title = FATIGUE_BAND_LABEL[band];
        detail = fatigue && fatigue.peak > 0 ? `Peak ${fmtHours(fatigue.peak)} in range` : 'Not rostered';
    } else if (cellMode === 'utilization') {
        // Averaged across the weeks on screen — utilization is a rate, so
        // summing it would be meaningless.
        const avgWeekHours = weeksOnScreen > 0 ? periodHours / weeksOnScreen : 0;
        const util = weekUtilization(avgWeekHours, contractedWeeklyHours);
        severity = UTILIZATION_SEVERITY[util.status];
        title = UTILIZATION_STATUS_LABEL[util.status];
        detail =
            util.status === 'none'
                ? 'No contracted hours on file'
                : `${Math.round(util.pct)}% of ${contractedWeeklyHours}h/wk`;
    } else if (cellMode === 'fairness') {
        const debt = unsociableDebt(standing);
        const band = fairnessBand(debt);
        severity = band === 'balanced' ? 'ok' : 'warning';
        title = FAIRNESS_BAND_LABEL[band];
        detail =
            debt === null
                ? 'No ledger entry'
                : `${debt > 0 ? '+' : ''}${debt} vs team over 91 days`;
    } else {
        severity = comp?.overallV8Severity ?? 'ok';
        title = SEVERITY_LABEL[severity];
        detail = comp?.worstDesc || '—';
    }

    const Icon = SEVERITY_ICON[severity];
    const style = severityStyle(severity, isDark);

    return (
        <div className="flex items-start gap-2 min-w-0">
            <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: style.mark }} aria-hidden="true" />
            <div className="flex flex-col min-w-0">
                <span
                    className="text-[10px] font-black uppercase tracking-tight leading-none mb-0.5"
                    style={{ color: style.mark }}
                >
                    {title}
                </span>
                <span className="text-[9px] text-muted-foreground leading-tight truncate" title={detail}>
                    {detail}
                </span>
            </div>
        </div>
    );
};

export const TeamAvailabilityGrid: React.FC<Props> = ({
    members,
    dates,
    cells,
    density = 'compact',
    onSelectMember,
    cellMode = 'availability',
    weekColumns = [],
    hoursByProfile,
    complianceByProfile,
    restrictedWorkLimits,
    fatigueByProfile,
    fairnessContribution,
    fairnessStanding,
}) => {
    const { isDark } = useTheme();

    const cellW = CELL_W[density];
    const rowH = ROW_H[density];
    const stickyBg = isDark ? 'bg-[#141c2e]' : 'bg-slate-50';

    const hasWeeks = weekColumns.length > 0;
    // NOT compliance-only. Utilization and fairness have no per-day value, so
    // this column is where their number is actually reported — gating it on the
    // compliance mode would leave those two modes with nothing to read.
    const showStatus =
        hasWeeks && (!!complianceByProfile || !!fatigueByProfile || !!fairnessStanding);

    const statusHeading =
        cellMode === 'fatigue'
            ? 'Fatigue'
            : cellMode === 'utilization'
              ? 'Utilization'
              : cellMode === 'fairness'
                ? 'Fairness'
                : 'Compliance';

    // Comfortable mode stretches the day cells to fill the table, so the share
    // each one gets has to account for the week and status columns too —
    // dividing the full width by `dates.length` alone overflows the row by
    // exactly the space they occupy.
    const dayWidth = density === 'comfortable'
        ? `calc((100% - ${NAME_COL + weekColumns.length * WEEK_COL + (showStatus ? STATUS_COL : 0)}px) / ${Math.max(1, dates.length)})`
        : `${cellW}px`;

    // One render order for the header and the body, so a week total can never
    // end up over a different set of days than the cells beneath it.
    const columnGroups = React.useMemo(
        () =>
            hasWeeks
                ? weekColumns.map((week) => ({
                      key: week.key,
                      week,
                      dates: week.visibleDates as ReadonlyArray<string>,
                  }))
                : [{ key: 'all', week: null as WeekColumn | null, dates }],
        [hasWeeks, weekColumns, dates],
    );

    /**
     * One (member, day) cell.
     *
     * The three modes share the cell's shape and differ only in what fills it —
     * that is the whole idea. Each one carries a written accessible label, so
     * identity never rests on the fill in any of them.
     */
    const renderDayCell = (
        member: TeamMember,
        date: string,
        cell: TeamDayCell | undefined,
        empHours: EmployeeHours | undefined,
        empComp: EmpComp | undefined,
    ) => {
        const when = format(parseISO(date), 'EEE d MMM');
        const shiftsToday = empHours?.byDate[date] ?? [];
        const hoursToday = shiftsToday.reduce((sum, s) => sum + s.netHours, 0);
        const hasDraft = shiftsToday.some((s) => s.isDraft);

        const base = cn(
            'w-full h-full flex items-center justify-center gap-1 rounded-xl border transition-all duration-150 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary text-foreground',
            density === 'comfortable'
                ? 'px-2.5 py-1 text-[11px] font-extrabold tabular-nums'
                : 'text-[10px] font-black',
        );

        if (cellMode === 'hours') {
            if (shiftsToday.length === 0) {
                return (
                    <div
                        tabIndex={0}
                        role="img"
                        aria-label={`${member.fullName}, ${when}: no hours`}
                        className={cn(base, 'border-transparent text-muted-foreground/30')}
                    >
                        —
                    </div>
                );
            }

            // Per-shift at comfortable width, where a split day is legible;
            // the day total once the columns narrow to a month.
            const text =
                density === 'comfortable'
                    ? shiftsToday.map((s) => `${fmtHours(s.netHours)}${s.isDraft ? 'd' : ''}`).join('+')
                    : fmtHours(hoursToday);

            const acc = `${member.fullName}, ${when}: ${fmtHours(hoursToday)} hours${
                hasDraft ? ', draft' : ''
            }${shiftsToday.length > 1 ? `, ${shiftsToday.length} shifts` : ''}`;

            return (
                <div
                    tabIndex={0}
                    role="img"
                    aria-label={acc}
                    title={shiftsToday
                        .map(
                            (s) =>
                                `${fmtHours(s.netHours)}h${s.roleName ? ` · ${s.roleName}` : ''}${
                                    s.deptName ? ` · ${s.deptName}` : ''
                                }${s.isDraft ? ' (draft)' : ''}`,
                        )
                        .join('\n')}
                    className={cn(base, hasDraft && 'border-dashed')}
                    style={{
                        backgroundColor: hoursFill(hoursToday, isDark) ?? 'transparent',
                        borderColor: hasDraft ? '#8987817a' : '#89878133',
                    }}
                >
                    <span className="truncate leading-none">{text}</span>
                </div>
            );
        }

        if (cellMode === 'compliance') {
            if (shiftsToday.length === 0) {
                return (
                    <div
                        tabIndex={0}
                        role="img"
                        aria-label={`${member.fullName}, ${when}: not rostered`}
                        className={cn(base, 'border-transparent text-muted-foreground/30')}
                    >
                        —
                    </div>
                );
            }

            const severity = daySeverity(empComp, date);
            const style = severityStyle(severity, isDark);

            return (
                <div
                    tabIndex={0}
                    role="img"
                    aria-label={`${member.fullName}, ${when}: ${fmtHours(hoursToday)} hours, ${SEVERITY_LABEL[severity]}`}
                    className={cn(base, hasDraft && 'border-dashed')}
                    style={{ backgroundColor: style.bg, borderColor: style.border }}
                >
                    <span className="leading-none" style={{ color: style.mark }} aria-hidden="true">
                        {style.glyph}
                    </span>
                    {density === 'comfortable' && (
                        <span className="truncate leading-none">{fmtHours(hoursToday)}</span>
                    )}
                </div>
            );
        }

        if (cellMode === 'fatigue') {
            const day = fatigueByProfile?.get(member.profileId)?.byDate.get(date);
            if (!day) {
                return (
                    <div
                        tabIndex={0}
                        role="img"
                        aria-label={`${member.fullName}, ${when}: not rostered`}
                        className={cn(base, 'border-transparent text-muted-foreground/30')}
                    >
                        —
                    </div>
                );
            }
            const style = severityStyle(FATIGUE_SEVERITY[day.band], isDark);
            return (
                <div
                    tabIndex={0}
                    role="img"
                    aria-label={`${member.fullName}, ${when}: fatigue ${day.score}, ${FATIGUE_BAND_LABEL[day.band]}`}
                    className={cn(base, hasDraft && 'border-dashed')}
                    style={{ backgroundColor: style.bg, borderColor: style.border }}
                >
                    <span className="leading-none" style={{ color: style.mark }} aria-hidden="true">
                        {style.glyph}
                    </span>
                    {density === 'comfortable' && (
                        <span className="truncate leading-none">{fmtHours(day.score)}</span>
                    )}
                </div>
            );
        }

        if (cellMode === 'utilization') {
            // Utilization has no daily value — the cell shows the hours that
            // BUILD it and the week column reports the percentage.
            if (shiftsToday.length === 0) {
                return (
                    <div
                        tabIndex={0}
                        role="img"
                        aria-label={`${member.fullName}, ${when}: no hours`}
                        className={cn(base, 'border-transparent text-muted-foreground/30')}
                    >
                        —
                    </div>
                );
            }
            return (
                <div
                    tabIndex={0}
                    role="img"
                    aria-label={`${member.fullName}, ${when}: ${fmtHours(hoursToday)} hours toward the week`}
                    className={cn(base, hasDraft && 'border-dashed')}
                    style={{
                        backgroundColor: hoursFill(hoursToday, isDark) ?? 'transparent',
                        borderColor: hasDraft ? '#8987817a' : '#89878133',
                    }}
                >
                    <span className="truncate leading-none">{fmtHours(hoursToday)}</span>
                </div>
            );
        }

        if (cellMode === 'fairness') {
            // Likewise: the cell is this day's CONTRIBUTION to the ledger, not
            // a fairness score. The standing is in the row summary.
            const contribution = fairnessContribution?.get(member.profileId)?.get(date);
            if (!contribution) {
                return (
                    <div
                        tabIndex={0}
                        role="img"
                        aria-label={`${member.fullName}, ${when}: not rostered`}
                        className={cn(base, 'border-transparent text-muted-foreground/30')}
                    >
                        —
                    </div>
                );
            }
            const ordinary = contribution.weight === 0;
            return (
                <div
                    tabIndex={0}
                    role="img"
                    aria-label={
                        ordinary
                            ? `${member.fullName}, ${when}: ordinary shift, no unsociable loading`
                            : `${member.fullName}, ${when}: ${contribution.labels.join(', ')}, weight ${contribution.weight}`
                    }
                    title={ordinary ? undefined : contribution.labels.join(' · ')}
                    className={cn(base, hasDraft && 'border-dashed')}
                    style={{
                        backgroundColor: ordinary
                            ? 'transparent'
                            : (hoursFill(Math.min(12, contribution.weight * 2), isDark) ?? 'transparent'),
                        borderColor: ordinary ? '#89878133' : '#8987817a',
                    }}
                >
                    <span className="truncate leading-none">
                        {ordinary ? '·' : density === 'comfortable'
                            ? contribution.labels[0]
                            : contribution.weight}
                    </span>
                </div>
            );
        }

        // ── availability (the original) ──
        if (!cell) return null;

        const soft = stateSoft(cell.state, isDark);
        const detail =
            cell.state === 'available' && cell.windows.length > 0
                ? ` ${cell.windows.map((w) => `${w.start}–${w.end}`).join(', ')}`
                : cell.state === 'assigned' && cell.shifts.length > 0
                  ? ` ${cell.shifts.map((s) => `${s.start}–${s.end}${s.roleName ? ` ${s.roleName}` : ''}`).join(', ')}`
                  : '';

        const windowText = cell.state === 'available' && cell.windows[0]
            ? `${cell.windows[0].start}–${cell.windows[0].end}`
            : cell.state === 'assigned' && cell.shifts[0]
              ? `${cell.shifts[0].start}–${cell.shifts[0].end}`
              : TEAM_DAY_STATE_LABELS[cell.state];

        return (
            <div
                tabIndex={0}
                role="img"
                aria-label={`${member.fullName}, ${when}: ${TEAM_DAY_STATE_LABELS[cell.state]}${detail}`}
                className={cn(base, soft.dashed && 'border-dashed')}
                style={{
                    backgroundColor: soft.bg,
                    borderColor: soft.border ?? '#89878152',
                }}
            >
                {density === 'comfortable' && (
                    <span className="truncate leading-none">{windowText}</span>
                )}
            </div>
        );
    };

    if (members.length === 0) {
        return (
            <div className="py-12 text-center border rounded-2xl bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground">
                    No team members match the current scope and filters.
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                    Widen the scope, or clear the role and employment filters.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-2.5">
            <CollapsibleBadgeLegend isDark={isDark} />

            <div className="flex-1 min-h-0 overflow-auto scrollbar-none max-h-[calc(100vh-240px)] relative rounded-2xl border border-slate-200/80 dark:border-white/5 bg-background/50 shadow-inner">
                <table className="w-full border-separate border-spacing-0">
                    <caption className="sr-only">
                        Team availability by member and day. Each cell states the member&apos;s
                        status for that date.
                    </caption>
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                className={cn(
                                    'sticky left-0 top-0 z-30 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground py-3 px-3.5 border-b border-r border-slate-200/60 dark:border-white/5 shadow-xs',
                                    stickyBg,
                                )}
                                style={{ width: NAME_COL, minWidth: NAME_COL }}
                            >
                                Team Member ({members.length})
                            </th>
                            {columnGroups.map((group) => (
                                <React.Fragment key={group.key}>
                                    {group.dates.map((d) => (
                                        <th
                                            key={d}
                                            scope="col"
                                            className={cn(
                                                'sticky top-0 z-20 py-2.5 px-1 text-center border-b border-r border-slate-200/60 dark:border-white/5 shadow-xs transition-colors text-muted-foreground',
                                                stickyBg,
                                            )}
                                            style={{ minWidth: cellW, width: dayWidth }}
                                        >
                                            <span className="block text-[10px] font-black uppercase tracking-wider leading-none">
                                                {format(parseISO(d), 'EEE')}
                                            </span>
                                            <span className="block text-xs font-black tabular-nums mt-0.5 leading-none">
                                                {format(parseISO(d), 'd MMM')}
                                            </span>
                                            <span className="sr-only">
                                                {format(parseISO(d), 'EEEE d MMMM yyyy')}
                                            </span>
                                        </th>
                                    ))}
                                    {group.week && (
                                        <th
                                            scope="col"
                                            className={cn(
                                                'sticky top-0 z-20 py-2.5 px-1 text-center border-b border-l-2 border-r border-slate-200/60 dark:border-white/5 border-l-primary/25 shadow-xs text-primary/70',
                                                stickyBg,
                                            )}
                                            style={{ minWidth: WEEK_COL, width: WEEK_COL }}
                                        >
                                            <span className="block text-[10px] font-black uppercase tracking-wider leading-none">
                                                {group.week.label}
                                            </span>
                                            <span className="block text-[9px] font-bold mt-0.5 leading-none opacity-70">
                                                {group.week.isPartial ? 'Full wk' : 'Total'}
                                            </span>
                                            <span className="sr-only">
                                                {group.week.isPartial
                                                    ? `Week ${group.week.label} total — full week, only ${group.week.visibleDates.length} of 7 days shown`
                                                    : `Week ${group.week.label} total`}
                                            </span>
                                        </th>
                                    )}
                                </React.Fragment>
                            ))}
                            {showStatus && (
                                <th
                                    scope="col"
                                    className={cn(
                                        'sticky right-0 top-0 z-30 py-2.5 px-3 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-l border-slate-200/60 dark:border-white/5 shadow-xs',
                                        stickyBg,
                                    )}
                                    style={{ minWidth: STATUS_COL, width: STATUS_COL }}
                                >
                                    {statusHeading}
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((member, rIdx) => {
                            const byDate = cells.get(member.profileId);
                            const empHours = hoursByProfile?.get(member.profileId);
                            const empComp = complianceByProfile?.get(member.profileId);
                            const empFatigue = fatigueByProfile?.get(member.profileId);
                            const isRestricted = restrictedWorkLimits?.has(member.profileId) ?? false;
                            const avatarStyle = empComp && empComp.overallV8Severity !== 'ok'
                                ? severityStyle(empComp.overallV8Severity, isDark)
                                : null;
                            const isEven = rIdx % 2 === 0;
                            const rowBg = isEven
                                ? isDark ? 'bg-[#111827]/40' : 'bg-slate-50/50'
                                : isDark ? 'bg-transparent' : 'bg-white';

                            return (
                                <tr key={member.profileId} className={cn('hover:bg-primary/5 transition-colors', rowBg)}>
                                    <th
                                        scope="row"
                                        className={cn(
                                            'sticky left-0 z-10 text-left px-3 py-2 border-b border-r border-slate-200/60 dark:border-white/5',
                                            stickyBg,
                                        )}
                                        style={{ width: NAME_COL, minWidth: NAME_COL }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onSelectMember?.(member)}
                                            className="text-left w-full rounded-xl p-1.5 transition-all hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div
                                                    className={cn(
                                                        'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border shadow-2xs',
                                                        !avatarStyle &&
                                                            'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground border-primary/20',
                                                    )}
                                                    style={
                                                        avatarStyle
                                                            ? {
                                                                  backgroundColor: avatarStyle.bg,
                                                                  borderColor: avatarStyle.border,
                                                                  color: avatarStyle.mark,
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    {getInitials(member.fullName)}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <span className="block text-[12px] font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                                        {member.fullName}
                                                    </span>
                                                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                        <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[110px]" title={member.roleName ?? 'No role'}>
                                                            {member.roleName ?? 'No role'}
                                                        </span>
                                                        {member.employmentStatus && (
                                                            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground shrink-0 border border-border/30">
                                                                {member.employmentStatus}
                                                            </span>
                                                        )}
                                                        {/* Their hours carry a legal ceiling this app
                                                            does not itself enforce. */}
                                                        {isRestricted && (
                                                            <span
                                                                className="inline-flex items-center gap-0.5 text-[8px] font-black uppercase tracking-tighter px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0"
                                                                title="Work-limited visa — hours are capped by their visa conditions"
                                                            >
                                                                <GraduationCap className="h-2 w-2" aria-hidden="true" />
                                                                Visa
                                                            </span>
                                                        )}
                                                        <MemberContractsPopover member={member} />
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    </th>

                                    {columnGroups.map((group) => (
                                        <React.Fragment key={group.key}>
                                            {group.dates.map((date) => (
                                                <td
                                                    key={date}
                                                    className="border-b border-r border-slate-200/40 dark:border-white/5 p-1 text-center align-middle"
                                                    style={{ minWidth: cellW, height: rowH }}
                                                >
                                                    {renderDayCell(member, date, byDate?.get(date), empHours, empComp)}
                                                </td>
                                            ))}

                                            {group.week && (
                                                <WeekTotalCell
                                                    week={group.week}
                                                    hours={empHours?.byWeek[group.week.key] ?? 0}
                                                    comp={empComp?.weeks[group.week.key]}
                                                    memberName={member.fullName}
                                                    isDark={isDark}
                                                    rowH={rowH}
                                                    cellMode={cellMode}
                                                    contractedWeeklyHours={member.contractedWeeklyHours}
                                                    weekPeakFatigue={peakFatigueInWeek(empFatigue, group.week)}
                                                />
                                            )}
                                        </React.Fragment>
                                    ))}

                                    {showStatus && (
                                        <td
                                            className={cn(
                                                'sticky right-0 z-10 px-3 py-2 border-b border-l border-slate-200/60 dark:border-white/5 align-middle',
                                                stickyBg,
                                            )}
                                            style={{ minWidth: STATUS_COL, width: STATUS_COL }}
                                        >
                                            <RowSummary
                                                comp={empComp}
                                                isDark={isDark}
                                                cellMode={cellMode}
                                                fatigue={empFatigue}
                                                standing={fairnessStanding?.get(member.profileId)}
                                                periodHours={empHours?.totalHours ?? 0}
                                                contractedWeeklyHours={member.contractedWeeklyHours}
                                                weeksOnScreen={Math.max(1, weekColumns.length)}
                                            />
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TeamAvailabilityGrid;
