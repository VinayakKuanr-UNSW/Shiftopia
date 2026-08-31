/**
 * Baseline FT — data hooks.
 *
 * ONE SUB-DEPARTMENT, PICKED EXPLICITLY. Baseline generates for a single team,
 * and the manager chooses which. It deliberately does NOT read `scope`'s first
 * entry: reading `scope.org_ids[0]` is a known defect class in this codebase —
 * thirteen-plus pages silently show one organisation's data to someone who can
 * see several — and a feature that WRITES shifts is the worst place to repeat
 * it. An unpicked sub-department yields no query, not a guess.
 *
 * THE WORLD IS A QUERY; THE PROPOSAL IS NOT. `useBaselineWorld` reads contracts,
 * shifts, leave and holidays for a team and a period. Computing what to propose
 * from that is pure and synchronous, so it lives in a `useMemo` on the page and
 * re-runs on every keystroke without touching the network.
 */

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import {
    applyBaseline,
    loadBaselineWorld,
    type ApplyBaselineInput,
    type ApplyRunResult,
    type BaselineWorld,
} from '../api/baselineFt.commands';
import {
    loadBaselinePatterns,
    saveBaselinePatterns,
    type SaveBaselinePatternsInput,
    type SaveBaselinePatternsResult,
} from '../api/baselineFtPatterns';
import { loadRosterCoverage } from '../api/rosterTarget';
import { DEFAULT_WEEKLY_HOURS } from '../domain/requirementCalculator';
import type { PatternRow } from '../domain/patternRow';
import { resolveComplianceBasis } from '@/modules/availability/domain/contract-basis';

export const baselineFtKeys = {
    all: ['baseline-ft'] as const,
    subDepartments: (subdeptIds: readonly string[]) =>
        [...baselineFtKeys.all, 'sub-departments', [...subdeptIds].sort()] as const,
    patterns: (subDepartmentId: string | null) =>
        [...baselineFtKeys.all, 'patterns', subDepartmentId] as const,
    world: (subDepartmentId: string | null, start: string, end: string) =>
        [...baselineFtKeys.all, 'world', subDepartmentId, start, end] as const,
    coverage: (subDepartmentId: string | null, start: string, end: string) =>
        [...baselineFtKeys.all, 'coverage', subDepartmentId, start, end] as const,
    ftProfile: (subDepartmentId: string | null) =>
        [...baselineFtKeys.all, 'ft-profile', subDepartmentId] as const,
};

/* ────────────────────────────────────────────────────────────────────────────
   The full-time shape of a sub-department
   ──────────────────────────────────────────────────────────────────────────── */

export interface FtProfile {
    /** Wholly-full-time employees contracted here. */
    employeeCount: number;
    /** Contracted weekly hours they share, or the 38h default when none say. */
    weeklyHours: number;
    /** True when they do NOT all share one figure. */
    weeklyHoursVaries: boolean;
    cycleWeeks: 1 | 2 | 3 | 4;
    roles: Array<{ id: string; name: string }>;
}

/**
 * What seeding a new row needs: the contracted quota a day length is derived
 * from.
 *
 * Reads the CONTRACTS rather than asking the author, because the day length is
 * a consequence of the weekly quota and the number of days, and a human typing
 * it has no margin: 38 ÷ 5 is 7.6h exactly, which is also the daily floor.
 */
export function useFtProfile(subDepartmentId: string | null) {
    return useQuery({
        queryKey: baselineFtKeys.ftProfile(subDepartmentId),
        enabled: Boolean(subDepartmentId),
        queryFn: async (): Promise<FtProfile> => {
            const { data, error } = await supabase
                .from('user_contracts')
                .select('user_id, role_id, employment_status, contracted_weekly_hours, ' +
                        'ordinary_hours_cycle_weeks, ordinary_hours_cycle_anchor, start_date')
                .eq('sub_department_id', subDepartmentId!)
                .eq('status', 'Active');
            if (error) throw error;

            const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
            const ftRows = rows.filter(r => {
                const basis = resolveComplianceBasis([{
                    employmentStatus: r.employment_status as string | null,
                    contractedWeeklyHours: (r.contracted_weekly_hours as number | null) ?? null,
                    startDate: r.start_date as string | null,
                    ordinaryHoursCycleWeeks: r.ordinary_hours_cycle_weeks as number | null,
                    ordinaryHoursCycleAnchor: r.ordinary_hours_cycle_anchor as string | null,
                }]);
                return basis.isFullTime;
            });

            const hours = [...new Set(
                ftRows.map(r => Number(r.contracted_weekly_hours)).filter(h => Number.isFinite(h) && h > 0),
            )];
            const cycles = [...new Set(
                ftRows.map(r => Number(r.ordinary_hours_cycle_weeks)).filter(Boolean),
            )];

            const roleIds = [...new Set(ftRows.map(r => String(r.role_id)).filter(Boolean))];
            let roles: Array<{ id: string; name: string }> = [];
            if (roleIds.length > 0) {
                const { data: roleRows } = await supabase
                    .from('roles').select('id, name').in('id', roleIds);
                roles = (roleRows ?? [])
                    .map(r => ({ id: String(r.id), name: String(r.name ?? '') }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }

            return {
                employeeCount: new Set(ftRows.map(r => String(r.user_id))).size,
                weeklyHours: hours.length > 0 ? Math.min(...hours) : DEFAULT_WEEKLY_HOURS,
                weeklyHoursVaries: hours.length > 1,
                // Shortest declared cycle is the strictest, matching
                // resolveGoverningCycleWeeks.
                cycleWeeks: (cycles.length > 0 ? Math.min(...cycles) : 4) as 1 | 2 | 3 | 4,
                roles,
            };
        },
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Sub-departments the manager may roster
   ──────────────────────────────────────────────────────────────────────────── */

export interface SubDepartmentOption {
    id: string;
    name: string;
    departmentId: string;
    organizationId: string;
}

export function useRosterableSubDepartments(subdeptIds: readonly string[]) {
    return useQuery({
        queryKey: baselineFtKeys.subDepartments(subdeptIds),
        enabled: subdeptIds.length > 0,
        queryFn: async (): Promise<SubDepartmentOption[]> => {
            const { data, error } = await supabase
                .from('sub_departments')
                .select('id, name, department_id, departments!inner(id, organization_id)')
                .in('id', subdeptIds as string[])
                .order('name');

            if (error) throw error;

            return (data ?? []).map(row => {
                const dept = (row as { departments?: { organization_id?: string } }).departments;
                return {
                    id: String(row.id),
                    name: String(row.name ?? ''),
                    departmentId: String(row.department_id ?? ''),
                    organizationId: String(dept?.organization_id ?? ''),
                };
            }).filter(s => s.departmentId && s.organizationId);
        },
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Patterns
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The saved patterns for a team, grouped into table rows.
 *
 * NOT keyed on the period: a standing pattern is the same in every window, so
 * navigating from one week to the next must not refetch it — and must not
 * discard unsaved edits by replacing the rows underneath them.
 */
export function useBaselinePatternRows(subDepartmentId: string | null) {
    return useQuery({
        queryKey: baselineFtKeys.patterns(subDepartmentId),
        enabled: Boolean(subDepartmentId),
        queryFn: async (): Promise<PatternRow[]> => {
            const { rows, findings } = await loadBaselinePatterns(subDepartmentId!);
            const blocking = findings.find(f => f.severity === 'BLOCKING');
            if (blocking) throw new Error(blocking.plain);
            return rows;
        },
    });
}

export function useSaveBaselinePatterns() {
    const qc = useQueryClient();
    return useMutation<SaveBaselinePatternsResult, Error, SaveBaselinePatternsInput>({
        mutationFn: input => saveBaselinePatterns(input),
        onSuccess: (_res, vars) => {
            void qc.invalidateQueries({ queryKey: baselineFtKeys.patterns(vars.subDepartmentId) });
        },
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   The world, and applying against it
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Contracts, existing shifts, leave and public holidays for a team and period.
 *
 * `keepPreviousData` so stepping from one week to the next keeps the table on
 * screen while the next window loads. A table that empties and refills on every
 * arrow press cannot be read, let alone edited.
 */
export function useBaselineWorld(
    subDepartmentId: string | null,
    periodStart: string,
    periodEnd: string,
) {
    return useQuery({
        queryKey: baselineFtKeys.world(subDepartmentId, periodStart, periodEnd),
        enabled: Boolean(subDepartmentId && periodStart && periodEnd),
        placeholderData: keepPreviousData,
        queryFn: (): Promise<BaselineWorld> => loadBaselineWorld({
            subDepartmentId: subDepartmentId!, periodStart, periodEnd,
        }),
    });
}

/**
 * Which dates in the window Apply could actually write into.
 *
 * Read up front so "three of these days have no draft roster" appears above the
 * button rather than as three skip reasons after it. With free date navigation
 * a manager will routinely land on a window the rosters do not cover.
 */
export function useRosterCoverage(
    subDepartmentId: string | null,
    periodStart: string,
    periodEnd: string,
) {
    return useQuery({
        queryKey: baselineFtKeys.coverage(subDepartmentId, periodStart, periodEnd),
        enabled: Boolean(subDepartmentId && periodStart && periodEnd),
        placeholderData: keepPreviousData,
        queryFn: () => loadRosterCoverage(subDepartmentId!, periodStart, periodEnd),
    });
}

export function useApplyBaseline() {
    const qc = useQueryClient();
    return useMutation<ApplyRunResult, Error, ApplyBaselineInput>({
        mutationFn: input => applyBaseline(input),
        onSuccess: () => {
            // Apply writes real shifts, so every roster view is now stale.
            void qc.invalidateQueries({ queryKey: baselineFtKeys.all });
            void qc.invalidateQueries({ queryKey: ['shifts'] });
            void qc.invalidateQueries({ queryKey: ['rosters'] });
        },
    });
}
