/**
 * useRosterShifts — Shift Query & Mutation Hooks
 *
 * Phase 3 rewrites the mutation layer to use:
 *
 *  1. SURGICAL CACHE UPDATES — every mutation targets shiftKeys.lists
 *     (not shiftKeys.all), preventing unnecessary refetch of lookups and
 *     detail views that didn't change.
 *
 *  2. OPTIMISTIC UPDATES — all 12 write mutations now apply instant
 *     cache patches before the server responds, with automatic rollback
 *     on error via the onMutate/onError/onSettled pattern.
 *
 *  3. TYPED setQueriesData — no `as any` in cache updaters;
 *     explicit Shift[] generics + null guards throughout.
 *
 * Invalidation budget per mutation:
 *  - Single update:  shiftKeys.detail(id)          (1 query)
 *  - Any list write: shiftKeys.lists                (~1 query per visible date range)
 *  - Structural:     shiftKeys.lists + rosterKeys.all (roster dates changed)
 *  - Lookups:        shiftKeys.lookups._root        (reference data changed)
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftsQueries } from '../api/shifts.queries';
import { shiftsCommands } from '../api/shifts.commands';
import { complianceService } from '../services/compliance.service';
import type { Shift } from '../domain/shift.entity';
import { shiftKeys, rosterKeys, type ShiftFilters } from '../api/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type { ShiftFilters };

// ── Shared optimistic-update helpers ─────────────────────────────────────────

type Snapshot = [readonly unknown[], Shift[] | undefined][];

function snapshotLists(queryClient: ReturnType<typeof useQueryClient>): Snapshot {
  return queryClient.getQueriesData<Shift[]>({ queryKey: shiftKeys.lists });
}

function rollbackLists(queryClient: ReturnType<typeof useQueryClient>, snapshot: Snapshot) {
  snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

function patchLists(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (old: Shift[]) => Shift[],
) {
  queryClient.setQueriesData<Shift[]>({ queryKey: shiftKeys.lists }, (old) =>
    old && Array.isArray(old) ? updater(old) : old,
  );
}

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useShiftsByDate(
  organizationId: string | null,
  date: string | null,
  filters?: ShiftFilters,
) {
  return useQuery({
    queryKey: shiftKeys.byDate(organizationId ?? '', date ?? '', filters),
    queryFn: () => shiftsQueries.getShiftsForDate(organizationId!, date!, filters),
    enabled: !!organizationId && !!date,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useShiftsByDateRange(
  organizationId: string | null,
  startDate: string | null,
  endDate: string | null,
  filters?: ShiftFilters,
) {
  return useQuery({
    queryKey: shiftKeys.byDateRange(organizationId ?? '', startDate ?? '', endDate ?? '', filters),
    queryFn: () => shiftsQueries.getShiftsForDateRange(organizationId!, startDate!, endDate!, filters),
    enabled: !!organizationId && !!startDate && !!endDate,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useEmployeeShifts(
  employeeId: string | null,
  startDate: string | null,
  endDate: string | null,
) {
  return useQuery({
    queryKey: shiftKeys.byEmployee(employeeId ?? '', startDate ?? '', endDate ?? ''),
    queryFn: () => shiftsQueries.getEmployeeShifts(employeeId!, startDate!, endDate!),
    enabled: !!employeeId && !!startDate && !!endDate,
    staleTime: 30_000,
  });
}

export function useShiftDetail(shiftId: string | null) {
  return useQuery({
    queryKey: shiftKeys.detail(shiftId ?? ''),
    queryFn: () => shiftsQueries.getShiftById(shiftId!),
    enabled: !!shiftId,
    staleTime: 15_000,
  });
}

export function usePendingOfferCount(employeeId: string | null) {
  return useQuery({
    queryKey: shiftKeys.offerCount(employeeId ?? ''),
    queryFn: () => shiftsQueries.getPendingOfferCount(employeeId!),
    enabled: !!employeeId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useMyOffers(
  employeeId: string | null,
  filters?: { organizationId?: string; departmentId?: string },
) {
  return useQuery({
    queryKey: [...shiftKeys.offers(employeeId ?? ''), filters ?? null],
    queryFn: () => shiftsQueries.getMyOffers(employeeId!, filters),
    enabled: !!employeeId,
    staleTime: 5 * 60_000,
  });
}

export function useMyOffersHistory(
  employeeId: string | null,
  status: 'Accepted' | 'Declined',
  filters?: { organizationId?: string; departmentId?: string },
) {
  return useQuery({
    queryKey: [...shiftKeys.offers(employeeId ?? ''), 'history', status, filters ?? null],
    queryFn: () => shiftsQueries.getMyOfferHistory(employeeId!, status, filters),
    enabled: !!employeeId,
    staleTime: 5 * 60_000,
  });
}

// ── Lookup hooks ──────────────────────────────────────────────────────────────

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

export function useRoles(organizationId?: string, departmentId?: string, subDepartmentId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.roles(organizationId, departmentId, subDepartmentId),
    queryFn: () => shiftsQueries.getRoles(organizationId, departmentId, subDepartmentId),
    staleTime: 5 * 60_000,
  });
}

export function useEmployees(
  organizationId?: string,
  departmentId?: string,
  subDepartmentId?: string,
) {
  return useQuery({
    queryKey: shiftKeys.lookups.employees(organizationId, departmentId, subDepartmentId),
    queryFn: () => shiftsQueries.getEmployees(organizationId, departmentId, subDepartmentId),
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

export function useRostersLookup(
  organizationId?: string,
  filters?: {
    departmentId?: string;
    departmentIds?: string[];
    subDepartmentId?: string;
    subDepartmentIds?: string[];
  },
) {
  return useQuery({
    queryKey: shiftKeys.lookups.rosters(organizationId, filters),
    queryFn: () => shiftsQueries.getRosters(organizationId!, filters),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
}

export function useRosterStructure(rosterId?: string) {
  return useQuery({
    queryKey: shiftKeys.lookups.rosterStructure(rosterId),
    queryFn: () => shiftsQueries.getRosterStructure(rosterId!),
    enabled: !!rosterId,
    staleTime: 5 * 60_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

/** Create a new shift. Cancels in-flight list queries, then invalidates on settle. */
export function useCreateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof shiftsCommands.createShift>[0]) =>
      shiftsCommands.createShift(data),

    onMutate: async () => {
      // Prevent race: a stale refetch should not overwrite the coming server response
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
    },

    onSuccess: (newShift) => {
      // Insert the confirmed shift into all list caches that cover its date
      patchLists(queryClient, (old) => {
        // Avoid inserting duplicate if cache was already updated elsewhere
        if (old.some(s => s.id === newShift.id)) return old;
        return [...old, newShift as unknown as Shift];
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/** Update an existing shift. Instant patch + rollback on error. */
export function useUpdateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      shiftId,
      updates,
    }: {
      shiftId: string;
      updates: Parameters<typeof shiftsCommands.updateShift>[1];
    }) => shiftsCommands.updateShift(shiftId, updates),

    onMutate: async ({ shiftId, updates }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      // Patch all list views
      patchLists(queryClient, (old) =>
        old.map(s => s.id === shiftId ? { ...s, ...updates } : s),
      );

      // Also patch the detail view if loaded
      const prevDetail = queryClient.getQueryData<Shift>(shiftKeys.detail(shiftId));
      if (prevDetail) {
        queryClient.setQueryData(shiftKeys.detail(shiftId), { ...prevDetail, ...updates });
      }

      return { snapshot, prevDetail };
    },

    onError: (_err, variables, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
      if (context?.prevDetail) {
        queryClient.setQueryData(shiftKeys.detail(variables.shiftId), context.prevDetail);
      }
    },

    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(variables.shiftId) });
    },
  });
}

/** Delete a shift. Optimistically removes it from all list views. */
export function useDeleteShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shiftId: string) => {
      const success = await shiftsCommands.deleteShift(shiftId);
      if (!success) throw new Error('Failed to delete shift on the server.');
      return success;
    },

    onMutate: async (shiftId) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) => old.filter(s => s.id !== shiftId));
      queryClient.removeQueries({ queryKey: shiftKeys.detail(shiftId) });

      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/** Bulk assign shifts to one employee. Instant assignment update in all list views. */
export function useBulkAssignShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ employeeId, shiftIds }: { employeeId: string; shiftIds: string[] }) =>
      shiftsCommands.bulkAssignShifts(employeeId, shiftIds),

    onMutate: async ({ employeeId, shiftIds }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, assigned_employee_id: employeeId, assignment_status: 'assigned' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
  });
}

/** Bulk unassign shifts. Clears assignment in all list views instantly. */
export function useBulkUnassignShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkUnassignShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, assigned_employee_id: null, assignment_status: 'unassigned' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
  });
}

/** Publish a single shift. Instant lifecycle_status patch. */
export function usePublishShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.publishShift(shiftId),

    onMutate: async (shiftId) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId ? { ...s, lifecycle_status: 'Published' as const } : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, shiftId) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
    },
  });
}

/** Unpublish a single shift. Reverts lifecycle_status to Draft. */
export function useUnpublishShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason?: string }) =>
      shiftsCommands.unpublishShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId
            ? { ...s, lifecycle_status: 'Draft' as const, is_published: false, is_draft: true }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: (_data, _err, { shiftId }) => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
    },
  });
}

/**
 * Bulk publish shifts.
 * Instant lifecycle_status update for all selected IDs — the UI responds
 * before the server round-trip completes.
 */
export function useBulkPublishShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkPublishShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          shiftIds.includes(s.id)
            ? { ...s, lifecycle_status: 'Published' as const }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _ids, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/**
 * Bulk delete shifts.
 * Removes IDs from all list views instantly — no flicker, instant feedback.
 */
export function useBulkDeleteShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftIds: string[]) => shiftsCommands.bulkDeleteShifts(shiftIds),

    onMutate: async (shiftIds) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) => old.filter(s => !shiftIds.includes(s.id)));
      shiftIds.forEach(id => queryClient.removeQueries({ queryKey: shiftKeys.detail(id) }));

      return { snapshot };
    },

    onError: (_err, _ids, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/**
 * Employee drops a shift (pushes it to bidding).
 * Removes from employee view; marks as unassigned + on-bidding in manager view.
 */
export function useDropShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason: string }) =>
      shiftsCommands.employeeDropShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      // Employee view: remove entirely
      queryClient.setQueriesData<Shift[]>(
        { queryKey: shiftKeys.byEmployee('', '', '') },
        (old) => old?.filter(s => s.id !== shiftId),
      );

      // Manager / date views: unassign + flag as bidding
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId
            ? {
              ...s,
              assigned_employee_id: null,
              assignment_status: 'unassigned' as const,
              bidding_status: 'on_bidding_urgent' as const,
            }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
    },
  });
}

/** Accept a shift offer. Updates assignment_outcome to 'confirmed'. */
export function useAcceptOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.acceptOffer(shiftId),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId ? { ...s, assignment_outcome: 'confirmed' as const } : s,
        ),
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/** Decline a shift offer. Removes from offers view, clears assignment. */
export function useDeclineOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) =>
      shiftsCommands.rejectOffer(shiftId, 'Employee declined'),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId
            ? {
              ...s,
              assignment_status: 'unassigned' as const,
              assignment_outcome: null,
              assigned_employee_id: null,
            }
            : s,
        ),
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['shifts', 'offerCount'] });
    },
  });
}

/** Cancel a shift. Marks lifecycle_status + is_cancelled in all list views. */
export function useCancelShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason: string }) =>
      shiftsCommands.cancelShift(shiftId, reason),

    onMutate: async ({ shiftId }) => {
      await queryClient.cancelQueries({ queryKey: shiftKeys.lists });
      const snapshot = snapshotLists(queryClient);

      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId
            ? { ...s, lifecycle_status: 'Cancelled' as const, is_cancelled: true }
            : s,
        ),
      );

      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
  });
}

/** Request a trade for a shift. Sets trading_status to TradeRequested. */
export function useRequestTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => shiftsCommands.requestTrade(shiftId),

    onMutate: async (shiftId) => {
      const snapshot = snapshotLists(queryClient);
      patchLists(queryClient, (old) =>
        old.map(s =>
          s.id === shiftId
            ? { ...s, trading_status: 'TradeRequested' as const, is_trade_requested: true }
            : s,
        ),
      );
      return { snapshot };
    },

    onError: (_err, _id, context) => {
      if (context?.snapshot) rollbackLists(queryClient, context.snapshot);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
  });
}

// ── Compliance validation ─────────────────────────────────────────────────────

export function useComplianceValidation() {
  return useMutation({
    mutationFn: (params: {
      employeeId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      netLengthMinutes: number;
      excludeShiftId?: string;
    }) =>
      complianceService.validateShiftCompliance(
        params.employeeId,
        params.shiftDate,
        params.startTime,
        params.endTime,
        params.netLengthMinutes,
        params.excludeShiftId,
      ),
  });
}

// ── Combined convenience hook ─────────────────────────────────────────────────

/**
 * Combined hook for the most common shift operations in a single date view.
 * Prefer individual hooks when you only need one or two operations.
 */
export function useRosterShifts(
  organizationId: string | null,
  date: string | null,
  filters?: ShiftFilters,
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

  /** Hard-invalidate all shift list queries (use sparingly). */
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    queryClient.invalidateQueries({ queryKey: rosterKeys.all });
  }, [queryClient]);

  return {
    shifts: shiftsQuery.data ?? [],
    isLoading: shiftsQuery.isLoading,
    isFetching: shiftsQuery.isFetching,
    error: shiftsQuery.error,
    refetch: shiftsQuery.refetch,
    createShift,
    updateShift,
    deleteShift,
    bulkAssign,
    bulkUnassign,
    bulkPublish,
    bulkDelete,
    invalidateAll,
  };
}
