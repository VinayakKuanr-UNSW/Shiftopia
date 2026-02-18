/**
 * useRosterShifts - Unified TanStack Query Hook for Shift Operations
 *
 * Phase 1 of Enterprise Rosters: Replaces manual useState/useEffect patterns
 * with React Query for automatic caching, deduplication, and background refresh.
 *
 * RESPONSIBILITIES:
 * - Shift queries with automatic caching (staleTime: 30s)
 * - Mutations with optimistic updates and cache invalidation
 * - Compliance validation integration
 * - Standardized error/loading states
 *
 * QUERY KEYS:
 * - ['shifts', 'byDate', orgId, date, filters]
 * - ['shifts', 'byEmployee', employeeId, startDate, endDate]
 * - ['shifts', 'detail', shiftId]
 * - ['shifts', 'offers', employeeId]
 * - ['shifts', 'offerCount', employeeId]
 * - ['shifts', 'auditLog', shiftId]
 * - ['shifts', 'lookups', type, ...params]
 */

import { useCallback } from 'react';
import {
    useQuery,
    useMutation,
    useQueryClient,
    UseQueryOptions,
} from '@tanstack/react-query';
import { shiftsQueries } from '../api/shifts.queries';
import { shiftsCommands } from '../api/shifts.commands';
import { complianceService, ComplianceValidationResult } from '../services/compliance.service';
import type { Shift, TemplateGroupType, ShiftStatus } from '../domain/shift.entity';
import { shiftKeys, ShiftFilters } from '../api/queryKeys';

// ============================================================================
// TYPES
// ============================================================================

export interface ShiftMutationResult {
    success: boolean;
    data?: Shift;
    error?: string;
    compliance?: ComplianceValidationResult;
}

// ============================================================================
// TYPES
// ============================================================================



export interface ShiftMutationResult {
    success: boolean;
    data?: Shift;
    error?: string;
    compliance?: ComplianceValidationResult;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch shifts for a specific date with optional filters.
 * Cached for 30 seconds, background refetch on window focus.
 */
export function useShiftsByDate(
    organizationId: string | null,
    date: string | null,
    filters?: ShiftFilters
) {
    return useQuery({
        queryKey: shiftKeys.byDate(organizationId || '', date || '', filters),
        queryFn: () =>
            shiftsQueries.getShiftsForDate(organizationId!, date!, {
                departmentId: filters?.departmentId,
                subDepartmentId: filters?.subDepartmentId,
                departmentIds: filters?.departmentIds,
                subDepartmentIds: filters?.subDepartmentIds,
                groupType: filters?.groupType,
                status: filters?.status,
            }),
        enabled: !!organizationId && !!date,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });
}

/**
 * Fetch shifts for a date range (week/month views).
 * Cached for 30 seconds, background refetch on window focus.
 */
export function useShiftsByDateRange(
    organizationId: string | null,
    startDate: string | null,
    endDate: string | null,
    filters?: ShiftFilters
) {
    return useQuery({
        queryKey: shiftKeys.byDateRange(organizationId!, startDate!, endDate!, filters),
        queryFn: () =>
            shiftsQueries.getShiftsForDateRange(organizationId!, startDate!, endDate!, {
                departmentId: filters?.departmentId,
                subDepartmentId: filters?.subDepartmentId,
                departmentIds: filters?.departmentIds,
                subDepartmentIds: filters?.subDepartmentIds,
                groupType: filters?.groupType,
                status: filters?.status,
            }),
        enabled: !!organizationId && !!startDate && !!endDate,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });
}

/**
 * Fetch shifts for an employee in a date range.
 */
export function useEmployeeShifts(
    employeeId: string | null,
    startDate: string | null,
    endDate: string | null
) {
    return useQuery({
        queryKey: shiftKeys.byEmployee(employeeId || '', startDate || '', endDate || ''),
        queryFn: () => shiftsQueries.getEmployeeShifts(employeeId!, startDate!, endDate!),
        enabled: !!employeeId && !!startDate && !!endDate,
        staleTime: 30_000,
    });
}

/**
 * Fetch a single shift by ID with full details.
 */
export function useShiftDetail(shiftId: string | null) {
    return useQuery({
        queryKey: shiftKeys.detail(shiftId || ''),
        queryFn: () => shiftsQueries.getShiftById(shiftId!),
        enabled: !!shiftId,
        staleTime: 15_000,
    });
}

/**
 * Fetch pending offer count for an employee.
 */
export function usePendingOfferCount(employeeId: string | null) {
    return useQuery({
        queryKey: shiftKeys.offerCount(employeeId || ''),
        queryFn: () => shiftsQueries.getPendingOfferCount(employeeId!),
        enabled: !!employeeId,
        staleTime: 60_000,
        refetchInterval: 60_000,
    });
}

/**
 * Hook to get my shift offers (S3 - Published + Offered)
 */
export function useMyOffers(employeeId: string | null, filters?: { organizationId?: string; departmentId?: string }) {
    return useQuery({
        queryKey: [...shiftKeys.offers(employeeId || ''), filters],
        queryFn: () => shiftsQueries.getMyOffers(employeeId!, filters),
        enabled: !!employeeId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

/**
 * Hook to get my offer history (Accepted/Declined)
 */
export function useMyOffersHistory(employeeId: string | null, status: 'Accepted' | 'Declined', filters?: { organizationId?: string; departmentId?: string }) {
    return useQuery({
        queryKey: [...shiftKeys.offers(employeeId || ''), 'history', status, filters],
        queryFn: () => shiftsQueries.getMyOfferHistory(employeeId!, status, filters),
        enabled: !!employeeId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}



// ============================================================================
// LOOKUP HOOKS (Long stale times - reference data)
// ============================================================================

export function useOrganizations() {
    return useQuery({
        queryKey: shiftKeys.lookups.organizations(),
        queryFn: () => shiftsQueries.getOrganizations(),
        staleTime: 5 * 60_000,
    });
}

export function useDepartments(organizationId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.departments(organizationId),
        queryFn: () => shiftsQueries.getDepartments(organizationId),
        staleTime: 5 * 60_000,
    });
}

export function useSubDepartments(departmentId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.subDepartments(departmentId),
        queryFn: () => shiftsQueries.getSubDepartments(departmentId),
        enabled: !!departmentId,
        staleTime: 5 * 60_000,
    });
}

export function useRoles(departmentId?: string, subDepartmentId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.roles(departmentId, subDepartmentId),
        queryFn: () => shiftsQueries.getRoles(departmentId, subDepartmentId),
        staleTime: 5 * 60_000,
    });
}

export function useEmployees(organizationId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.employees(organizationId),
        queryFn: () => shiftsQueries.getEmployees(organizationId),
        staleTime: 2 * 60_000,
    });
}

export function useTemplates(subDepartmentId?: string, departmentId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.templates(subDepartmentId, departmentId),
        queryFn: () => shiftsQueries.getTemplates(subDepartmentId, departmentId),
        staleTime: 5 * 60_000,
    });
}

export function useRemunerationLevels() {
    return useQuery({
        queryKey: shiftKeys.lookups.remunerationLevels(),
        queryFn: () => shiftsQueries.getRemunerationLevels(),
        staleTime: 10 * 60_000,
    });
}

export function useSkills() {
    return useQuery({
        queryKey: shiftKeys.lookups.skills(),
        queryFn: () => shiftsQueries.getSkills(),
        staleTime: 10 * 60_000,
    });
}

export function useLicenses() {
    return useQuery({
        queryKey: shiftKeys.lookups.licenses(),
        queryFn: () => shiftsQueries.getLicenses(),
        staleTime: 10 * 60_000,
    });
}

export function useEvents(organizationId?: string) {
    return useQuery({
        queryKey: shiftKeys.lookups.events(organizationId),
        queryFn: () => shiftsQueries.getEvents(organizationId),
        staleTime: 2 * 60_000,
    });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create a new shift with optional compliance validation.
 */
export function useCreateShift() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: Parameters<typeof shiftsCommands.createShift>[0]) => {
            return shiftsCommands.createShift(data);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
                queryClient.invalidateQueries({ queryKey: ['enhanced-rosters'] })
            ]);
        },
    });
}

/**
 * Update an existing shift.
 */
export function useUpdateShift() {
    const queryClient = useQueryClient();


    return useMutation({
        mutationFn: async ({
            shiftId,
            updates,
        }: {
            shiftId: string;
            updates: Parameters<typeof shiftsCommands.updateShift>[1];
        }) => {
            return shiftsCommands.updateShift(shiftId, updates);
        },
        onMutate: async ({ shiftId, updates }) => {
            await queryClient.cancelQueries({ queryKey: shiftKeys.all });

            const previousShifts = queryClient.getQueriesData({ queryKey: shiftKeys.all });

            queryClient.setQueriesData({ queryKey: shiftKeys.all }, (oldData: any) => {
                if (!oldData) return oldData;
                if (Array.isArray(oldData)) {
                    return oldData.map((shift: Shift) =>
                        shift.id === shiftId ? { ...shift, ...updates } : shift
                    );
                }
                return oldData;
            });

            // Also update the detail view specifically if it exists
            const previousDetail = queryClient.getQueryData(shiftKeys.detail(shiftId));
            if (previousDetail) {
                queryClient.setQueryData(shiftKeys.detail(shiftId), (oldData: any) => ({ ...oldData, ...updates }));
            }

            return { previousShifts, previousDetail };
        },
        onError: (_err, variables, context) => {
            if (context?.previousShifts) {
                context.previousShifts.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }
            if (context?.previousDetail) {
                queryClient.setQueryData(shiftKeys.detail(variables.shiftId), context.previousDetail);
            }
        },
        onSuccess: async (_data, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.detail(variables.shiftId) }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}

/**
 * Delete a shift.
 */
export function useDeleteShift() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftId: string) => {
            return shiftsCommands.deleteShift(shiftId);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}

/**
 * Employee drop a shift (pushes to bidding).
 */
export function useDropShift() {
    const queryClient = useQueryClient();


    return useMutation({
        mutationFn: async ({ shiftId, reason }: { shiftId: string; reason: string }) => {
            return shiftsCommands.employeeDropShift(shiftId, reason);
        },
        onMutate: async ({ shiftId }) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: shiftKeys.all });

            // Snapshot previous value
            const previousShifts = queryClient.getQueriesData({ queryKey: shiftKeys.all });

            // 1. Handle Employee Views (Remove the shift)
            queryClient.setQueriesData({ queryKey: ['shifts', 'byEmployee'] }, (oldData: any) => {
                if (!oldData || !Array.isArray(oldData)) return oldData;
                return oldData.filter((shift: Shift) => shift.id !== shiftId);
            });

            // 2. Handle Manager/Roster Views (Update status to Open/Bidding)
            queryClient.setQueriesData({ queryKey: ['shifts', 'byDate'] }, (oldData: any) => {
                if (!oldData || !Array.isArray(oldData)) return oldData;
                return oldData.map((shift: Shift) => {
                    if (shift.id === shiftId) {
                        return {
                            ...shift,
                            assigned_employee_id: null,
                            status: 'published', // Assumed state after drop
                            bidding_status: 'on_bidding_urgent', // Assumed urgent if dropped
                            // We might also want to clear employee details if nested, but usually IDs are enough for lists
                        };
                    }
                    return shift;
                });
            });

            // 3. Handle Generic/Detail Views
            // Be careful not to remove it from 'detail' unless we want to, but detail usually refetches.
            // We can optimistically update detail too
            const previousDetail = queryClient.getQueryData(shiftKeys.detail(shiftId));
            if (previousDetail) {
                queryClient.setQueryData(shiftKeys.detail(shiftId), (oldData: any) => ({
                    ...oldData,
                    assigned_employee_id: null,
                    bidding_status: 'on_bidding_urgent'
                }));
            }

            return { previousShifts, previousDetail };
        },
        onError: (_err, _newTodo, context) => {
            // If the mutation fails, use the context returned from onMutate to roll back
            if (context?.previousShifts) {
                context.previousShifts.forEach(([queryKey, data]) => {
                    queryClient.setQueryData(queryKey, data);
                });
            }
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Bulk assign shifts to an employee.
 */
export function useBulkAssignShifts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            employeeId,
            shiftIds,
        }: {
            employeeId: string;
            shiftIds: string[];
        }) => {
            return shiftsCommands.bulkAssignShifts(employeeId, shiftIds);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}

/**
 * Bulk unassign shifts.
 */
export function useBulkUnassignShifts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftIds: string[]) => {
            return shiftsCommands.bulkUnassignShifts(shiftIds);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}

/**
 * Publish a single shift.
 */
export function usePublishShift() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftId: string) => {
            return shiftsCommands.publishShift(shiftId);
        },
        onSuccess: async (_data, shiftId) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}

/**
 * Bulk publish shifts.
 */
export function useBulkPublishShifts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftIds: string[]) => {
            return shiftsCommands.bulkPublishShifts(shiftIds);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}



/**
 * Bulk delete shifts.
 */
export function useBulkDeleteShifts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftIds: string[]) => {
            return shiftsCommands.bulkDeleteShifts(shiftIds);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] })
            ]);
        },
    });
}



/**
 * Accept a shift offer (employee action).
 */
export function useAcceptOffer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftId: string) => {
            return shiftsCommands.acceptOffer(shiftId);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Decline a shift offer (employee action).
 */
export function useDeclineOffer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftId: string) => {
            return shiftsCommands.rejectOffer(shiftId, 'Employee declined');
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Cancel a shift (manager action).
 */
export function useCancelShift() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ shiftId, reason }: { shiftId: string; reason: string }) => {
            return shiftsCommands.cancelShift(shiftId, reason);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Request a shift trade (employee action).
 */
export function useRequestTrade() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shiftId: string) => {
            return shiftsCommands.requestTrade(shiftId);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
                queryClient.invalidateQueries({ queryKey: ['rosters'] }),
            ]);
        },
    });
}

/**
 * Fetch rosters for an organization.
 */
export function useRostersLookup(organizationId?: string, filters?: {
    departmentId?: string;
    departmentIds?: string[];
    subDepartmentId?: string;
    subDepartmentIds?: string[];
}) {
    return useQuery({
        queryKey: ['rosters', 'byOrg', organizationId, filters] as const,
        queryFn: () => shiftsQueries.getRosters(organizationId!, filters),
        enabled: !!organizationId,
        staleTime: 5 * 60_000,
    });
}

export function useRosterStructure(rosterId?: string) {
    return useQuery({
        queryKey: ['rosterStructure', rosterId],
        queryFn: () => shiftsQueries.getRosterStructure(rosterId || ''),
        enabled: !!rosterId && rosterId !== '',
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

// ============================================================================
// COMPLIANCE HOOK
// ============================================================================

/**
 * Validate shift compliance for an employee.
 */
export function useComplianceValidation() {
    return useMutation({
        mutationFn: async ({
            employeeId,
            shiftDate,
            startTime,
            endTime,
            netLengthMinutes,
            excludeShiftId,
        }: {
            employeeId: string;
            shiftDate: string;
            startTime: string;
            endTime: string;
            netLengthMinutes: number;
            excludeShiftId?: string;
        }) => {
            return complianceService.validateShiftCompliance(
                employeeId,
                shiftDate,
                startTime,
                endTime,
                netLengthMinutes,
                excludeShiftId
            );
        },
    });
}

// ============================================================================
// COMBINED HOOK (convenience wrapper)
// ============================================================================

/**
 * Combined hook that provides the most common shift operations.
 * Use individual hooks for more specific needs.
 */
export function useRosterShifts(
    organizationId: string | null,
    date: string | null,
    filters?: ShiftFilters
) {
    const queryClient = useQueryClient();
    const shiftsQuery = useShiftsByDate(organizationId, date, filters);
    const createShift = useCreateShift();
    const updateShift = useUpdateShift();
    const deleteShift = useDeleteShift();
    const bulkAssign = useBulkAssignShifts();
    const bulkUnassign = useBulkUnassignShifts();
    const bulkPublish = useBulkPublishShifts();
    const bulkDelete = useBulkDeleteShifts();

    const invalidateAll = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: shiftKeys.all });
        queryClient.invalidateQueries({ queryKey: ['rosters'] });
        queryClient.invalidateQueries({ queryKey: ['enhanced-rosters'] });
    }, [queryClient]);

    return {
        // Query state
        shifts: shiftsQuery.data ?? [],
        isLoading: shiftsQuery.isLoading,
        isFetching: shiftsQuery.isFetching,
        error: shiftsQuery.error,
        refetch: shiftsQuery.refetch,

        // Mutations
        createShift,
        updateShift,
        deleteShift,
        bulkAssign,
        bulkUnassign,
        bulkPublish,
        bulkDelete,

        // Utilities
        invalidateAll,
    };
}
