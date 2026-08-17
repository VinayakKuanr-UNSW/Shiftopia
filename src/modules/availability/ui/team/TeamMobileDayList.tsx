/**
 * TeamMobileDayList — the phone composition.
 *
 * WHY A LIST AND NOT THE GRID. A people × days matrix cannot be made to pass
 * WCAG 2.1 SC 1.4.10 (Reflow): at 320 CSS px it requires scrolling in two
 * directions at once to read a single value, and shrinking the cells to fit
 * takes the text below the 1.4.4 resize floor instead. So the phone does not
 * get a smaller grid — it gets a different composition of the same data: one
 * day, members down the page, one card each.
 *
 * The card body follows the same `cellMode` the desktop cells do, so the two
 * surfaces never disagree about what a mode means. Compliance and the week
 * total stay available at day scope because `useTeamHours` always reads a
 * three-week lookback regardless of what is on screen.
 *
 * ACCESSIBILITY — the specific obligations this file is written against:
 *   1.3.1  a real <ul>/<li> list and a <dl> per card, so the label→value
 *          pairing survives being read out of visual order
 *   1.4.1  every state carries its word; colour is only ever the second channel
 *   1.4.3  values and labels wear text tokens, never the status hue (the
 *          light-mode status steps sit at 2.75–3:1 and are icon/label-paired
 *          by design — see coverage-palette.ts)
 *   1.4.10 single-column, no horizontal scroll at 320px
 *   2.5.5  every control is at least 44 x 44 CSS px
 *   4.1.2  the card is a real <button> when it activates something, and inert
 *          markup when it does not
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, GraduationCap, ShieldAlert } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { isoWeekKeyFromISO, shortWeekLabel, type EmpComp, type EmployeeHours } from '../../domain/hours-compliance';
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
} from '../../domain/team-metrics';
import { severityStyle, stateSoft, type ComplianceSeverity } from './coverage-palette';
import {
    TEAM_DAY_STATE_LABELS,
    type TeamDayCell,
    type TeamMember,
} from '../../model/team-availability.types';
import type { CellMode } from './TeamAvailabilityGrid';

interface Props {
    members: ReadonlyArray<TeamMember>;
    /** yyyy-MM-dd — the single day on screen. */
    date: string;
    cells: Map<string, Map<string, TeamDayCell>>;
    cellMode?: CellMode;
    hoursByProfile?: Map<string, EmployeeHours>;
    complianceByProfile?: Map<string, EmpComp>;
    restrictedWorkLimits?: ReadonlySet<string>;
    onSelectMember?: (member: TeamMember) => void;
    fatigueByProfile?: Map<string, EmployeeFatigue>;
    fairnessContribution?: Map<string, Map<string, DayFairnessContribution>>;
    fairnessStanding?: Map<string, FairnessStanding>;
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

/** Same mapping the grid uses — fatigue and utilization reuse the status ramp. */
const FATIGUE_SEVERITY = { ok: 'ok', risk: 'warning', critical: 'violation' } as const;
const UTILIZATION_SEVERITY = {
    none: 'ok', under: 'warning', ideal: 'ok', over: 'warning', critical: 'violation',
} as const;

const fmtHours = (h: number) => parseFloat(h.toFixed(1)).toString();

const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
};

/**
 * One label/value pair. A <dl> rather than two spans so a screen reader still
 * pairs them when it reads the card out of visual order.
 */
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex flex-col gap-0.5 min-w-0">
        <dt className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
            {label}
        </dt>
        <dd className="text-[13px] font-bold text-foreground truncate">{children}</dd>
    </div>
);

export const TeamMobileDayList: React.FC<Props> = ({
    members,
    date,
    cells,
    cellMode = 'availability',
    hoursByProfile,
    complianceByProfile,
    restrictedWorkLimits,
    onSelectMember,
    fatigueByProfile,
    fairnessContribution,
    fairnessStanding,
}) => {
    const { isDark } = useTheme();
    const weekKey = isoWeekKeyFromISO(date);
    const headingId = `team-day-${date}`;

    if (members.length === 0) {
        return (
            <div className="py-12 px-4 text-center border rounded-2xl bg-muted/10">
                <p className="text-sm font-semibold text-muted-foreground">
                    No team members match the current scope and filters.
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1.5">
                    Widen the scope, or clear the employment filter.
                </p>
            </div>
        );
    }

    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
            <h2 id={headingId} className="sr-only">
                {`${format(parseISO(date), 'EEEE d MMMM yyyy')} — ${members.length} team members`}
            </h2>

            <ul role="list" className="flex flex-col gap-2.5 list-none p-0 m-0">
                {members.map((member) => {
                    const cell = cells.get(member.profileId)?.get(date);
                    const empHours = hoursByProfile?.get(member.profileId);
                    const empComp = complianceByProfile?.get(member.profileId);
                    const isRestricted = restrictedWorkLimits?.has(member.profileId) ?? false;

                    const shiftsToday = empHours?.byDate[date] ?? [];
                    const hoursToday = shiftsToday.reduce((sum, s) => sum + s.netHours, 0);
                    const hasDraft = shiftsToday.some((s) => s.isDraft);
                    const weekHours = empHours?.byWeek[weekKey] ?? 0;

                    const dayFatigue = fatigueByProfile?.get(member.profileId)?.byDate.get(date);
                    const contribution = fairnessContribution?.get(member.profileId)?.get(date);
                    const util = weekUtilization(weekHours, member.contractedWeeklyHours);
                    const debt = unsociableDebt(fairnessStanding?.get(member.profileId));
                    const band = fairnessBand(debt);

                    // The headline badge follows the mode, so a fatigue view is
                    // not headlined by a compliance verdict.
                    const severity: ComplianceSeverity =
                        cellMode === 'fatigue'
                            ? FATIGUE_SEVERITY[dayFatigue?.band ?? 'ok']
                            : cellMode === 'utilization'
                              ? UTILIZATION_SEVERITY[util.status]
                              : cellMode === 'fairness'
                                ? (band === 'balanced' ? 'ok' : 'warning')
                                : (empComp?.overallV8Severity ?? 'ok');
                    const severityLabel =
                        cellMode === 'fatigue'
                            ? FATIGUE_BAND_LABEL[dayFatigue?.band ?? 'ok']
                            : cellMode === 'utilization'
                              ? UTILIZATION_STATUS_LABEL[util.status]
                              : cellMode === 'fairness'
                                ? FAIRNESS_BAND_LABEL[band]
                                : SEVERITY_LABEL[severity];
                    const sev = severityStyle(severity, isDark);
                    const SeverityIcon = SEVERITY_ICON[severity];
                    const showSeverity =
                        cellMode !== 'availability' &&
                        (!!empComp || cellMode === 'fatigue' || cellMode === 'utilization' || cellMode === 'fairness');

                    const state = cell?.state;
                    const soft = state ? stateSoft(state, isDark) : null;

                    // Everything the card says, in one string, so the summary is
                    // announced before the detail rather than after it.
                    const summary = [
                        member.fullName,
                        member.roleName ?? 'No role',
                        member.employmentStatus,
                        isRestricted ? 'work-limited visa' : null,
                        cellMode === 'availability' && state
                            ? TEAM_DAY_STATE_LABELS[state]
                            : null,
                        cellMode !== 'availability'
                            ? shiftsToday.length > 0
                                ? `${fmtHours(hoursToday)} hours${hasDraft ? ' draft' : ''}`
                                : 'not rostered'
                            : null,
                        cellMode !== 'availability' ? `week ${fmtHours(weekHours)} hours` : null,
                        showSeverity ? severityLabel : null,
                    ]
                        .filter(Boolean)
                        .join(', ');

                    const body = (
                        <>
                            <div className="flex items-start gap-3">
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 border',
                                        !showSeverity || severity === 'ok'
                                            ? 'bg-primary/10 text-primary border-primary/20'
                                            : '',
                                    )}
                                    style={
                                        showSeverity && severity !== 'ok'
                                            ? { backgroundColor: sev.bg, borderColor: sev.border, color: sev.mark }
                                            : undefined
                                    }
                                >
                                    {getInitials(member.fullName)}
                                </span>

                                <span className="min-w-0 flex-1">
                                    <span className="block text-[15px] font-bold text-foreground truncate">
                                        {member.fullName}
                                    </span>
                                    <span className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        <span className="text-xs font-medium text-muted-foreground truncate max-w-[45%]">
                                            {member.roleName ?? 'No role'}
                                        </span>
                                        {member.employmentStatus && (
                                            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/30">
                                                {member.employmentStatus}
                                            </span>
                                        )}
                                        {isRestricted && (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                                <GraduationCap className="h-2.5 w-2.5" aria-hidden="true" />
                                                Visa
                                            </span>
                                        )}
                                    </span>
                                </span>

                                {showSeverity && (
                                    <span className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                        <SeverityIcon
                                            className="h-4 w-4"
                                            style={{ color: sev.mark }}
                                            aria-hidden="true"
                                        />
                                        {/* The word, not just the hue — 1.4.1. */}
                                        <span className="text-[11px] font-black uppercase tracking-wider text-foreground">
                                            {severityLabel}
                                        </span>
                                    </span>
                                )}
                            </div>

                            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 mt-3 pt-3 border-t border-border/30">
                                {cellMode === 'availability' && (
                                    <>
                                        <Fact label="Status">
                                            <span className="inline-flex items-center gap-1.5">
                                                <span
                                                    aria-hidden="true"
                                                    className={cn(
                                                        'w-2.5 h-2.5 rounded-full border shrink-0',
                                                        soft?.dashed && 'border-dashed',
                                                    )}
                                                    style={{
                                                        backgroundColor: soft?.bg,
                                                        borderColor: soft?.border ?? '#89878152',
                                                    }}
                                                />
                                                {state ? TEAM_DAY_STATE_LABELS[state] : '—'}
                                            </span>
                                        </Fact>
                                        <Fact label={cell?.state === 'assigned' ? 'Shift' : 'Declared'}>
                                            {cell?.state === 'assigned' && cell.shifts[0]
                                                ? `${cell.shifts[0].start}–${cell.shifts[0].end}`
                                                : cell?.windows[0]
                                                  ? `${cell.windows[0].start}–${cell.windows[0].end}`
                                                  : '—'}
                                        </Fact>
                                    </>
                                )}

                                {cellMode !== 'availability' && (
                                    <>
                                        <Fact label="Hours today">
                                            {shiftsToday.length > 0 ? (
                                                <>
                                                    {fmtHours(hoursToday)}h
                                                    {hasDraft && (
                                                        <span className="ml-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                                            Draft
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                '—'
                                            )}
                                        </Fact>
                                        <Fact label={`Week ${shortWeekLabel(weekKey)} total`}>
                                            {weekHours > 0 ? `${fmtHours(weekHours)}h` : '—'}
                                        </Fact>
                                    </>
                                )}

                                {cellMode === 'fatigue' && (
                                    <Fact label="Fatigue today">
                                        {dayFatigue
                                            ? `${fmtHours(dayFatigue.score)} · ${FATIGUE_BAND_LABEL[dayFatigue.band]}`
                                            : 'Not rostered'}
                                    </Fact>
                                )}

                                {/* Measured against a WEEKLY contract, so the
                                    label says which week it is, not "today". */}
                                {cellMode === 'utilization' && (
                                    <Fact label={`Week ${shortWeekLabel(weekKey)} of contract`}>
                                        {util.status === 'none'
                                            ? 'No contract'
                                            : `${Math.round(util.pct)}% · ${UTILIZATION_STATUS_LABEL[util.status]}`}
                                    </Fact>
                                )}

                                {cellMode === 'fairness' && (
                                    <>
                                        <Fact label="This day contributed">
                                            {contribution && contribution.weight > 0
                                                ? contribution.labels.join(' · ')
                                                : shiftsToday.length > 0
                                                  ? 'Ordinary shift'
                                                  : 'Not rostered'}
                                        </Fact>
                                        {/* The standing is a 91-day cohort
                                            comparison — not a property of today. */}
                                        <Fact label="Share over 91 days">
                                            {debt === null
                                                ? 'No ledger entry'
                                                : `${debt > 0 ? '+' : ''}${debt} · ${FAIRNESS_BAND_LABEL[band]}`}
                                        </Fact>
                                    </>
                                )}
                            </dl>

                            {cellMode === 'compliance' && empComp && (
                                <p className="mt-2.5 text-xs font-semibold text-muted-foreground">
                                    {empComp.worstDesc}
                                </p>
                            )}
                        </>
                    );

                    const cardClass = cn(
                        'w-full text-left rounded-2xl border border-border/40 bg-card/60 p-3.5 transition-colors',
                        // 2.5.5 — the whole card is the target, comfortably past 44px.
                        'min-h-[44px]',
                    );

                    return (
                        <li key={member.profileId}>
                            {onSelectMember ? (
                                <button
                                    type="button"
                                    onClick={() => onSelectMember(member)}
                                    aria-label={summary}
                                    className={cn(
                                        cardClass,
                                        'hover:bg-muted/50 active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                                    )}
                                >
                                    {body}
                                </button>
                            ) : (
                                // No activation, so no button role — 4.1.2. The
                                // group carries the same summary as its name.
                                <div role="group" aria-label={summary} className={cardClass}>
                                    {body}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default TeamMobileDayList;
