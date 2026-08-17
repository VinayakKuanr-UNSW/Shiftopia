/**
 * useTeamHours — the shift read that hours and compliance are computed from.
 *
 * WHY IT IS A SECOND QUERY. `useTeamAvailability` fetches exactly the visible
 * range, which is correct for availability: a Tuesday's declared windows do not
 * depend on last month. Hours compliance is not local in that way. The
 * ordinary-hours rules average over rolling 2, 3 and 4-week windows, so a
 * window ending inside the visible range reaches back up to three ISO weeks
 * BEFORE it. Computed from a 7-day Week view, a 4-week window sums to roughly a
 * quarter of the truth and paints a confident green on a real breach — a
 * silent false negative on a compliance panel, which is worse than no panel.
 *
 * So this reads a wider range than it displays:
 *
 *     visible:  [startDate .............................. endDate]
 *     fetched:  [startOfISOWeek(startDate) − 21d ... endOfISOWeek(endDate)]
 *                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                ^^^^^^^^^^^
 *                three prior ISO weeks, so a 4-week      whole weeks, so the
 *                window ending in the first visible      week-total columns are
 *                week has its history                    true totals and not
 *                                                        sums of visible days
 *
 * Weeks outside the visible range are computed and never rendered; they exist
 * only to make the windows and the week totals true. Rendering is driven by the
 * visible range alone.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §2.1, §2.2
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eachDayOfInterval, endOfISOWeek, format, startOfISOWeek, subDays } from 'date-fns';
import type { ScopeSelection } from '@/platform/auth/types';
import { getTeamShifts } from '../api/team-availability.api';
import {
    buildHoursByEmployee,
    buildWeekColumns,
    computeEmpComp,
    type EmpComp,
    type TeamHoursFold,
    type WeekColumn,
} from '../domain/hours-compliance';
import {
    buildFatigueByEmployee,
    dayFairnessContribution,
    type DayFairnessContribution,
    type EmployeeFatigue,
} from '../domain/team-metrics';
import type { RawTeamShift, TeamMember } from '../model/team-availability.types';

/**
 * Three ISO weeks. The longest rolling window the ordinary-hours rules use is
 * four weeks, and the fourth is the one being reported on.
 */
export const COMPLIANCE_LOOKBACK_DAYS = 21;

export interface HoursRange {
    /** Inclusive, widened. What is FETCHED. */
    start: Date;
    end: Date;
}

export interface UseTeamHoursResult {
    shifts: RawTeamShift[];
    /** The widened range these shifts cover — not the range on screen. */
    range: HoursRange;
    /** Per-employee daily and weekly hours, folded over the WIDENED range. */
    hours: TeamHoursFold;
    /** profileId -> severity, windows and daily caps. */
    complianceByProfile: Map<string, EmpComp>;
    /** profileId -> peak fatigue per worked day. Genuinely a daily quantity. */
    fatigueByProfile: Map<string, EmployeeFatigue>;
    /**
     * profileId -> date -> what that day contributed to the fairness ledger.
     * NOT that person's fairness — see domain/team-metrics.ts.
     */
    fairnessContribution: Map<string, Map<string, DayFairnessContribution>>;
    /** Total columns for the VISIBLE axis — where each one is drawn. */
    weekColumns: WeekColumn[];
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    shiftsTruncated: boolean;
    refetch: () => void;
}

/**
 * Widen a visible range to whole ISO weeks plus the compliance lookback.
 *
 * Exported and pure so the week-column builder and the tests agree with the
 * fetch about where a week starts, rather than each deciding for itself.
 */
export function toHoursRange(startDate: Date, endDate: Date): HoursRange {
    return {
        start: subDays(startOfISOWeek(startDate), COMPLIANCE_LOOKBACK_DAYS),
        end: endOfISOWeek(endDate),
    };
}

function scopeKey(scope: ScopeSelection): string {
    return [
        [...(scope.org_ids ?? [])].sort().join(','),
        [...(scope.dept_ids ?? [])].sort().join(','),
        [...(scope.subdept_ids ?? [])].sort().join(','),
    ].join('|');
}

export function useTeamHours(
    scope: ScopeSelection | null,
    startDate: Date,
    endDate: Date,
    members: readonly TeamMember[],
): UseTeamHoursResult {
    const range = useMemo(() => toHoursRange(startDate, endDate), [startDate, endDate]);

    const key = scope ? scopeKey(scope) : '';
    const startStr = format(range.start, 'yyyy-MM-dd');
    const endStr = format(range.end, 'yyyy-MM-dd');
    const enabled = !!scope && (scope.org_ids?.length ?? 0) > 0;

    // Keyed on the WIDENED range, so every visible range that resolves to the
    // same fetch shares one cache entry instead of re-reading the same weeks.
    const query = useQuery({
        queryKey: ['team-hours', key, startStr, endStr] as const,
        enabled,
        staleTime: 60_000,
        queryFn: () => getTeamShifts(scope!, range.start, range.end),
    });

    const shifts = query.data?.shifts;

    const hours = useMemo(
        () => buildHoursByEmployee(shifts ?? [], members, range),
        [shifts, members, range],
    );

    // Computed over the WIDENED week set (`hours.sortedWeekKeys`) and rendered
    // over the visible one — the whole point of the widening.
    const complianceByProfile = useMemo(() => {
        const out = new Map<string, EmpComp>();
        for (const member of members) {
            const entry = hours.byProfile.get(member.profileId);
            if (!entry) continue;
            out.set(
                member.profileId,
                computeEmpComp(
                    entry.byWeek,
                    entry.byDate,
                    hours.sortedWeekKeys,
                    member.contractType ?? null,
                    member.contractedWeeklyHours,
                ),
            );
        }
        return out;
    }, [members, hours]);

    // Driven by the VISIBLE range: this is where columns are DRAWN. What they
    // contain comes from `hours`, which is why a partial week still totals true.
    const visibleDates = useMemo(
        () => eachDayOfInterval({ start: startDate, end: endDate }).map((d) => format(d, 'yyyy-MM-dd')),
        [startDate, endDate],
    );

    const weekColumns = useMemo(() => buildWeekColumns(visibleDates), [visibleDates]);

    // Fatigue reads a 7-day trailing window per day, so it is fed the WIDENED
    // shift set and asked only for the visible dates.
    const fatigueByProfile = useMemo(
        () => buildFatigueByEmployee(shifts ?? [], members, visibleDates),
        [shifts, members, visibleDates],
    );

    // Per (member, day) contribution to the ledger — Sat/Sun/night/PH. Only
    // days actually worked produce an entry.
    const fairnessContribution = useMemo(() => {
        const out = new Map<string, Map<string, DayFairnessContribution>>();
        const byProfileDate = new Map<string, RawTeamShift[]>();
        for (const s of shifts ?? []) {
            if (!s.assignedEmployeeId) continue;
            const key = `${s.assignedEmployeeId}|${s.shiftDate}`;
            const list = byProfileDate.get(key);
            if (list) list.push(s);
            else byProfileDate.set(key, [s]);
        }
        for (const member of members) {
            const byDate = new Map<string, DayFairnessContribution>();
            for (const date of visibleDates) {
                const dayShifts = byProfileDate.get(`${member.profileId}|${date}`);
                if (!dayShifts) continue;
                const contribution = dayFairnessContribution(dayShifts);
                if (contribution) byDate.set(date, contribution);
            }
            out.set(member.profileId, byDate);
        }
        return out;
    }, [shifts, members, visibleDates]);

    return {
        shifts: shifts ?? [],
        range,
        hours,
        complianceByProfile,
        fatigueByProfile,
        fairnessContribution,
        weekColumns,
        isLoading: query.isLoading,
        isError: query.isError,
        error: (query.error as Error) ?? null,
        shiftsTruncated: query.data?.truncated ?? false,
        refetch: () => void query.refetch(),
    };
}
