/**
 * Availability Data Hook – Phase-3 (Slots Authoritative)
 *
 * RESPONSIBILITIES:
 * - Fetch availability_rules for editing
 * - Fetch availability_slots for calendar display
 * - Expose mutation helpers
 * - Coordinate cache invalidation
 *
 * MUST NOT:
 * - Expand rules into slots
 * - Perform recurrence logic
 * - Handle edit mode (handled elsewhere)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useToast } from "@/modules/core/hooks/use-toast";

import {
  getAvailabilityRules,
  getAvailabilitySlots,
  deleteAvailabilityRule,
  getCurrentProfileId,
} from "../api/availability.api";

import {
  createAvailabilityFromForm,
  resolveProfileId,
} from "../api/availability.service";

import {
  AvailabilityRule,
  AvailabilitySlot,
  AvailabilityFormPayload,
} from "../model/availability.types";

import { translateDatabaseError } from "../utils/validation.utils";

// ============================================================================
// QUERY KEYS
// ============================================================================

/**
 * THE SCOPE IS PART OF THE KEY, not just the query.
 *
 * Without it, switching from Set-up to Front of House serves Set-up's slots
 * from cache — and on the Capacitor WebView it would never self-correct,
 * because `refetchOnWindowFocus` hangs off `visibilitychange`, which that
 * WebView never fires. Every `staleTime` becomes cache-forever there, so a key
 * that omits a dimension is not a stale-data risk on mobile, it is a permanent
 * one.
 *
 * `?? 'all'` rather than leaving undefined in the tuple: an undefined array
 * member and an absent one serialise the same way, which would collapse the
 * unscoped key onto whichever scope was requested first.
 */
const QUERY_KEYS = {
  rules: (profileId: string, subDepartmentId?: string | null) =>
    ["availability", "rules", profileId, subDepartmentId ?? "all"] as const,

  slots: (
    profileId: string,
    startDate: string,
    endDate: string,
    subDepartmentId?: string | null
  ) =>
    [
      "availability",
      "slots",
      profileId,
      startDate,
      endDate,
      subDepartmentId ?? "all",
    ] as const,
};

// ============================================================================
// TYPES
// ============================================================================

export interface UseAvailabilityOptions {
  profileId?: string; // Defaults to 'current-user'
  month?: Date;       // Defaults to current month
  /**
   * Run the queries at all. Defaults to true.
   *
   * `false` for Full-Time employees: they hold no rules and no slots by design
   * (20260817120000) and the page renders no view onto either, so fetching would
   * re-query two tables on every month change to render nothing.
   */
  enabled?: boolean;
  /**
   * WHICH JOB this page is showing. Omit for the person-wide view — every
   * declaration the profile holds — which is what this hook did before scoping.
   */
  subDepartmentId?: string | null;
}

export interface UseAvailabilityResult {
  // Data
  rules: AvailabilityRule[];
  slots: AvailabilitySlot[];

  // Loading states
  isLoadingRules: boolean;
  isLoadingSlots: boolean;

  // Mutations
  createRule: (payload: AvailabilityFormPayload) => Promise<void>;
  deleteRule: (ruleId: string) => Promise<void>;

  // Manual refresh
  refreshRules: () => Promise<void>;
  refreshSlots: () => Promise<void>;

  // Date range
  startDate: string;
  endDate: string;
  month: Date;
  getDayAvailability: (date: Date) => AvailabilitySlot[];
  subDepartmentId?: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

export function useAvailability(
  options: UseAvailabilityOptions = {}
): UseAvailabilityResult {
  const {
    profileId = "current-user",
    month = new Date(),
    enabled = true,
    subDepartmentId = null,
  } = options;

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const startDate = format(startOfMonth(month), "yyyy-MM-dd");
  const endDate = format(endOfMonth(month), "yyyy-MM-dd");

  // ============================================================================
  // RULES QUERY (EDITING ONLY)
  // ============================================================================

  const {
    data: rules = [],
    isLoading: isLoadingRules,
    refetch: refetchRules,
  } = useQuery({
    queryKey: QUERY_KEYS.rules(profileId, subDepartmentId),
    queryFn: async () => {
      const resolvedProfileId = await resolveProfileId(profileId);
      return getAvailabilityRules(resolvedProfileId, subDepartmentId);
    },
    enabled,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });

  // ============================================================================
  // SLOTS QUERY (CALENDAR + SCHEDULER VIEW)
  // ============================================================================

  const {
    data: slots = [],
    isLoading: isLoadingSlots,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: QUERY_KEYS.slots(profileId, startDate, endDate, subDepartmentId),
    queryFn: async () => {
      const resolvedProfileId = await resolveProfileId(profileId);
      return getAvailabilitySlots(
        resolvedProfileId,
        startDate,
        endDate,
        subDepartmentId
      );
    },
    enabled,
    staleTime: 1000 * 60 * 2,
    retry: 3,
  });

  // ============================================================================
  // CREATE RULE
  // ============================================================================

  const createRuleMutation = useMutation({
    mutationFn: async (payload: AvailabilityFormPayload) => {
      const resolvedProfileId = await resolveProfileId(profileId);
      // The VIEW's scope wins unless the payload names one explicitly. A form
      // that forgot to carry the scope would otherwise write an unscoped rule
      // — one covering every job — while the page showed a single job's
      // calendar, and the DB would accept it because unscoped is legal.
      return createAvailabilityFromForm(resolvedProfileId, {
        ...payload,
        sub_department_id: payload.sub_department_id ?? subDepartmentId,
      });
    },

    onSuccess: async () => {
      // Rules are immediately consistent
      // Rules are immediately consistent
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rules(profileId, subDepartmentId),
        }),
        // Slots may be eventually consistent
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.slots(profileId, startDate, endDate, subDepartmentId),
        })
      ]);

      toast({
        title: "Success",
        description: "Availability saved",
      });
    },

    onError: (error) => {
      toast({
        title: "Error",
        description: translateDatabaseError(error),
        variant: "destructive",
      });
    },
  });

  // ============================================================================
  // DELETE RULE
  // ============================================================================

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      await deleteAvailabilityRule(ruleId);
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rules(profileId, subDepartmentId),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.slots(profileId, startDate, endDate, subDepartmentId),
        })
      ]);

      toast({
        title: "Deleted",
        description: "Availability removed",
      });
    },

    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete availability",
        variant: "destructive",
      });
    },
  });

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  const createRule = async (payload: AvailabilityFormPayload) => {
    await createRuleMutation.mutateAsync(payload);
  };

  const deleteRule = async (ruleId: string) => {
    await deleteRuleMutation.mutateAsync(ruleId);
  };

  const refreshRules = async () => {
    await refetchRules();
  };

  const refreshSlots = async () => {
    await refetchSlots();
  };

  return {
    rules,
    slots,
    isLoadingRules,
    isLoadingSlots,
    createRule,
    deleteRule,
    refreshRules,
    refreshSlots,
    startDate,
    endDate,
    month,
    getDayAvailability: (date: Date) => {
      const dateStr = format(date, "yyyy-MM-dd");
      return slots.filter((s) => s.slot_date === dateStr);
    },
    subDepartmentId: subDepartmentId ?? null,
  };
}
