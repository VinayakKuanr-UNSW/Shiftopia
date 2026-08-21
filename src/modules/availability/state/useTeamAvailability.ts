/**
 * useTeamAvailability — the page's single data hook.
 *
 * Fetches members → then availability / shifts / leave / required in parallel,
 * and folds them through the pure domain layer into the
 * Required · Available · Assigned · Gap · Unset model.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eachDayOfInterval, format } from 'date-fns';
import type { ScopeSelection } from '@/platform/auth/types';
import { todayISO } from '@/modules/core/lib/date.utils';
import {
    getResolvedAvailabilities,
    getTeamLeaveDays,
    getTeamMembers,
    getTeamShifts,
    resolveRequired,
} from '../api/team-availability.api';
import {
    buildCoverageBuckets,
    buildTeamDayCells,
    findNearMisses,
    summarise,
    type NearMiss,
} from '../domain/team-coverage';
import type {
    TeamAvailabilityData,
    TeamAvailabilityInputs,
} from '../model/team-availability.types';

export interface TeamAvailabilityFilters {
    /** Substring match on member name. */
    search?: string;
    /** Empty = all. */
    roleIds?: string[];
    /** 'Casual' | 'Full-Time' | 'Part-Time'. Empty = all. */
    employmentStatuses?: string[];
}

export interface UseTeamAvailabilityResult {
    data: TeamAvailabilityData | null;
    nearMisses: NearMiss[];
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    /** The shift read hit its row ceiling — see `TeamShiftsResult.truncated`. */
    shiftsTruncated: boolean;
    refetch: () => void;
}

function scopeKey(scope: ScopeSelection): string {
    return [
        [...(scope.org_ids ?? [])].sort().join(','),
        [...(scope.dept_ids ?? [])].sort().join(','),
        [...(scope.subdept_ids ?? [])].sort().join(','),
    ].join('|');
}

export function useTeamAvailability(
    scope: ScopeSelection | null,
    startDate: Date,
    endDate: Date,
    filters: TeamAvailabilityFilters = {},
): UseTeamAvailabilityResult {
    const key = scope ? scopeKey(scope) : '';
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');
    const enabled = !!scope && (scope.org_ids?.length ?? 0) > 0;

    const query = useQuery({
        queryKey: ['team-availability', key, startStr, endStr] as const,
        enabled,
        staleTime: 60_000,
        queryFn: async (): Promise<TeamAvailabilityInputs & { shiftsTruncated: boolean }> => {
            const members = await getTeamMembers(scope!);
            const profileIds = members.map((m) => m.profileId);

            // When EXACTLY ONE sub-department is selected, scope the
            // availability read to that job. When several or none are selected,
            // pass null (person-wide, today's behaviour) — because attributing
            // one declaration to several sub-departments at once is exactly the
            // bug this scoping work exists to fix.
            const subDeptIds = (scope!.subdept_ids ?? []).filter(Boolean);
            const scopedSubDeptId = subDeptIds.length === 1 ? subDeptIds[0] : null;

            const [availability, shiftsResult, leaveDays, required] = await Promise.all([
                getResolvedAvailabilities(profileIds, startDate, endDate, scopedSubDeptId),
                getTeamShifts(scope!, startDate, endDate),
                getTeamLeaveDays(profileIds, startDate, endDate),
                resolveRequired(scope!, startDate, endDate),
            ]);

            const dates = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
                format(d, 'yyyy-MM-dd'),
            );

            return {
                members,
                dates,
                availability,
                shifts: shiftsResult.shifts,
                shiftsTruncated: shiftsResult.truncated,
                leaveDays,
                required: required.required,
                requiredSource: required.source,
            };
        },
    });

    // Filters are applied AFTER the fetch so changing one does not refetch —
    // the expensive part is the four network round-trips, not the folding.
    const filtered = useMemo<TeamAvailabilityInputs | null>(() => {
        if (!query.data) return null;
        const { search, roleIds, employmentStatuses } = filters;

        const needle = search?.trim().toLowerCase();
        const roleSet = roleIds?.length ? new Set(roleIds) : null;
        const empSet = employmentStatuses?.length ? new Set(employmentStatuses) : null;

        const members = query.data.members.filter((m) => {
            if (needle && !m.fullName.toLowerCase().includes(needle)) return false;
            if (roleSet && (!m.roleId || !roleSet.has(m.roleId))) return false;
            if (empSet && (!m.employmentStatus || !empSet.has(m.employmentStatus))) return false;
            return true;
        });

        return { ...query.data, members };
    }, [query.data, filters]);

    const folded = useMemo<{ data: TeamAvailabilityData | null; nearMisses: NearMiss[] }>(() => {
        if (!filtered) return { data: null, nearMisses: [] };

        const cells = buildTeamDayCells(filtered);
        const buckets = buildCoverageBuckets(filtered);
        const summary = summarise(filtered, cells, buckets, todayISO());

        return {
            data: {
                members: filtered.members,
                cells,
                buckets,
                summary,
                dates: filtered.dates,
            },
            nearMisses: findNearMisses(filtered, cells),
        };
    }, [filtered]);

    return {
        data: folded.data,
        nearMisses: folded.nearMisses,
        isLoading: query.isLoading,
        // Surfaced deliberately: PostgREST 400s the whole select on one bad
        // column name, and react-query's default would render that as a clean
        // empty state indistinguishable from "nobody is available".
        isError: query.isError,
        error: (query.error as Error) ?? null,
        shiftsTruncated: query.data?.shiftsTruncated ?? false,
        refetch: () => void query.refetch(),
    };
}
