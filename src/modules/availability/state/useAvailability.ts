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

const QUERY_KEYS = {
  rules: (profileId: string) =>
    ["availability", "rules", profileId] as const,

  slots: (profileId: string, startDate: string, endDate: string) =>
    ["availability", "slots", profileId, startDate, endDate] as const,
};

// ============================================================================
// TYPES
// ============================================================================

export interface UseAvailabilityOptions {
  profileId?: string; // Defaults to 'current-user'
  month?: Date;       // Defaults to current month
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
}

// ============================================================================
// HOOK
// ============================================================================

export function useAvailability(
  options: UseAvailabilityOptions = {}
): UseAvailabilityResult {
  const { profileId = "current-user", month = new Date() } = options;

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
    queryKey: QUERY_KEYS.rules(profileId),
    queryFn: async () => {
      const resolvedProfileId = await resolveProfileId(profileId);
      return getAvailabilityRules(resolvedProfileId);
    },
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
    queryKey: QUERY_KEYS.slots(profileId, startDate, endDate),
    queryFn: async () => {
      const resolvedProfileId = await resolveProfileId(profileId);
      return getAvailabilitySlots(resolvedProfileId, startDate, endDate);
    },
    staleTime: 1000 * 60 * 2,
    retry: 3,
  });

  // ============================================================================
  // CREATE RULE
  // ============================================================================

  const createRuleMutation = useMutation({
    mutationFn: async (payload: AvailabilityFormPayload) => {
      const resolvedProfileId = await resolveProfileId(profileId);
      return createAvailabilityFromForm(resolvedProfileId, payload);
    },

    onSuccess: async () => {
      // Rules are immediately consistent
      // Rules are immediately consistent
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rules(profileId),
        }),
        // Slots may be eventually consistent
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.slots(profileId, startDate, endDate),
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
          queryKey: QUERY_KEYS.rules(profileId),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.slots(profileId, startDate, endDate),
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
  };
}
