import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    rostersApi as enhancedRosterService,
    CreateRosterFromTemplateParams
} from '@/modules/rosters/api/rosters.api';
// ── Query Key Factory ──────────────────────────────────────────────
export const rosterKeys = {
    all: ['enhanced-rosters'] as const,
    byDate: (date: string, departmentId: string) =>
        ['enhanced-rosters', date, departmentId] as const,
    byRange: (startDate: string, endDate: string, departmentId: string, organizationId?: string, subDepartmentId?: string) =>
        ['enhanced-rosters', 'range', startDate, endDate, departmentId, organizationId, subDepartmentId] as const,
    conflict: (startDate: string, endDate: string, departmentId: string, organizationId?: string, subDepartmentId?: string) =>
        ['enhanced-rosters', 'conflict', startDate, endDate, departmentId, organizationId, subDepartmentId] as const,
};

// ── Queries ────────────────────────────────────────────────────────

/**
 * Query: Get roster by date
 */
export function useRosterByDate(date: string, departmentId: string) {
    return useQuery({
        queryKey: rosterKeys.byDate(date, departmentId),
        queryFn: () => enhancedRosterService.getRosterByDate(date, departmentId),
        enabled: !!date && !!departmentId,
    });
}

/**
 * Query: Get rosters by date range
 */
export function useRostersByDateRange(
    startDate: string,
    endDate: string,
    departmentId: string,
    organizationId?: string,
    subDepartmentId?: string
) {
    return useQuery({
        queryKey: rosterKeys.byRange(startDate, endDate, departmentId, organizationId, subDepartmentId),
        queryFn: () =>
            enhancedRosterService.getRostersByDateRange(
                startDate,
                endDate,
                departmentId,
                organizationId,
                subDepartmentId
            ),
        enabled: !!startDate && !!endDate && !!departmentId && !!organizationId,
    });
}

/**
 * Query: Check for date range conflicts
 */
export function useCheckDateRangeConflict(
    startDate: string,
    endDate: string,
    departmentId: string,
    organizationId?: string,
    subDepartmentId?: string,
    enabled: boolean = false
) {
    return useQuery({
        queryKey: rosterKeys.conflict(startDate, endDate, departmentId, organizationId, subDepartmentId),
        queryFn: () =>
            enhancedRosterService.checkDateRangeConflict(
                startDate,
                endDate,
                departmentId
            ),
        enabled: enabled && !!startDate && !!endDate && !!departmentId && !!organizationId,
    });
}

// ── Mutations ──────────────────────────────────────────────────────

/**
 * Mutation: Create rosters from template for date range
 */
export function useCreateRostersFromTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: CreateRosterFromTemplateParams) =>
            enhancedRosterService.createRostersFromTemplate(params),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Mutation: Update roster
 */
export function useUpdateRoster() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            rosterId,
            updates,
        }: {
            rosterId: string;
            updates: Partial<{
                groups: any[];
                status: 'draft' | 'published';
                is_locked: boolean;
            }>;
        }) => enhancedRosterService.updateRoster(rosterId, updates),
        onSuccess: async (data) => {
            if (data) {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
                    queryClient.invalidateQueries({ queryKey: ['rosters'] }),
                ]);
            }
        },
    });
}

/**
 * Mutation: Assign employee to shift
 */
export function useAssignEmployeeToShift() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            rosterId,
            groupId,
            subGroupId,
            shiftId,
            employeeId,
        }: {
            rosterId: string;
            groupId: number;
            subGroupId: number;
            shiftId: string;
            employeeId: string;
        }) =>
            enhancedRosterService.assignEmployeeToShift(
                rosterId,
                groupId,
                subGroupId,
                shiftId,
                employeeId
            ),
        onSuccess: async (data) => {
            if (data) {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: rosterKeys.all }),
                    queryClient.invalidateQueries({ queryKey: ['rosters'] }),
                ]);
            }
        },
    });
}
