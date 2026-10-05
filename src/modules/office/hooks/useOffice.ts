/**
 * Office — data hooks.
 *
 * ONE SUB-DEPARTMENT, PICKED EXPLICITLY. Office generates for a single team,
 * and the manager chooses which. It deliberately does NOT read `scope`'s first
 * entry: reading `scope.org_ids[0]` is a known defect class in this codebase —
 * thirteen-plus pages silently show one organisation's data to someone who can
 * see several — and a feature that WRITES shifts is the worst place to repeat
 * it. An unpicked sub-department yields no query, not a guess.
 *
 * THE WORLD IS A QUERY; THE PROPOSAL IS NOT. `useOfficeWorld` reads contracts,
 * shifts, leave and holidays for a team and a period. Computing what to propose
 * from that is pure and synchronous, so it lives in a `useMemo` on the page and
 * re-runs on every keystroke without touching the network.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { loadOfficeWorld, type OfficeWorld } from '../api/office.commands';
import { loadRosterCoverage } from '../api/rosterTarget';
import { loadLeaveDays } from '../api/office.loaders';

import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';

export const officeKeys = {
    all: ["office"] as const,
    subDepartments: (subdeptIds: readonly string[]) =>
        [...officeKeys.all, 'sub-departments', [...subdeptIds].sort()] as const,
    world: (subDepartmentId: string | null, start: string, end: string) =>
        [...officeKeys.all, 'world', subDepartmentId, start, end] as const,
    coverage: (subDepartmentId: string | null, start: string, end: string) =>
        [...officeKeys.all, 'coverage', subDepartmentId, start, end] as const,
    weekShifts: (employeeIds: readonly string[], start: string, end: string) =>
        [...officeKeys.all, 'week-shifts', [...employeeIds].sort(), start, end] as const,
    leaveDays: (employeeIds: readonly string[], start: string, end: string) =>
        [...officeKeys.all, 'leave-days', [...employeeIds].sort(), start, end] as const,
};

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
        queryKey: officeKeys.subDepartments(subdeptIds),
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
   The world, and applying against it
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Contracts, existing shifts, leave and public holidays for a team and period.
 *
 * `keepPreviousData` so stepping from one week to the next keeps the table on
 * screen while the next window loads. A table that empties and refills on every
 * arrow press cannot be read, let alone edited.
 */
export function useOfficeWorld(
    subDepartmentId: string | null,
    periodStart: string,
    periodEnd: string,
) {
    return useQuery({
        queryKey: officeKeys.world(subDepartmentId, periodStart, periodEnd),
        enabled: Boolean(subDepartmentId && periodStart && periodEnd),
        placeholderData: keepPreviousData,
        queryFn: (): Promise<OfficeWorld> => loadOfficeWorld({
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
/**
 * The week's shifts, straight from `shifts`.
 *
 * SEPARATE FROM `useOfficeWorld` ON PURPOSE. The world loader reads a window
 * widened to whole CYCLES, because consumption has to be counted over complete
 * cycles to avoid over-rostering, and it projects each row down to the handful of
 * fields the compliance engine needs (`ExistingShift`: id, date, times, net).
 * The grid needs the opposite: a narrow window and the WHOLE row, because a card
 * renders breaks, actual clocking, timesheet status, remuneration and group
 * provenance. Widening the world's projection to serve both would make every
 * compliance pass carry ~60 columns it never reads.
 */
export function useOfficeWeekShifts(
    employeeIds: readonly string[],
    periodStart: string,
    periodEnd: string,
) {
    return useQuery({
        queryKey: officeKeys.weekShifts(employeeIds, periodStart, periodEnd),
        enabled: employeeIds.length > 0 && Boolean(periodStart && periodEnd),
        placeholderData: keepPreviousData,
        queryFn: () => shiftsQueries.getShiftsForEmployeesInRange(
            employeeIds, periodStart, periodEnd),
    });
}

/**
 * Leave days over an arbitrary range.
 *
 * `useOfficeWorld` already loads leave, but only over the visible period. Copy-to
 * takes a range the manager types, which routinely extends past it — so a copy
 * over the next two months has to read leave for those months or it would happily
 * write shifts onto approved leave.
 */
export function useOfficeLeave(
    employeeIds: readonly string[],
    fromDate: string,
    toDate: string,
    enabled: boolean,
) {
    return useQuery({
        queryKey: officeKeys.leaveDays(employeeIds, fromDate, toDate),
        enabled: enabled && employeeIds.length > 0 && Boolean(fromDate && toDate),
        queryFn: () => loadLeaveDays(employeeIds, fromDate, toDate),
    });
}

export function useRosterCoverage(
    subDepartmentId: string | null,
    periodStart: string,
    periodEnd: string,
) {
    return useQuery({
        queryKey: officeKeys.coverage(subDepartmentId, periodStart, periodEnd),
        enabled: Boolean(subDepartmentId && periodStart && periodEnd),
        placeholderData: keepPreviousData,
        queryFn: () => loadRosterCoverage(subDepartmentId!, periodStart, periodEnd),
    });
}
