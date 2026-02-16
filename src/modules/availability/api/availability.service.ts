/**
 * Availability Service Layer – Final (DB Trigger Based Slots)
 *
 * RESPONSIBILITIES:
 * - Rule orchestration (create / edit / delete)
 * - Enforce "Edit = Delete + Create"
 * - Coordinate availability lifecycle
 *
 * SLOT MATERIALIZATION:
 * - Fully handled by PostgreSQL trigger on availability_rules
 * - This service does NOT and MUST NOT trigger slot generation
 *
 * MUST NOT:
 * - Expand rules into slots
 * - Perform date iteration for slots
 * - Call Edge Functions
 * - Contain UI or layout logic
 */

import {
  createAvailabilityRule,
  deleteAvailabilityRule,
  deleteAvailabilityRulesInRange,
  getAvailabilityRules,
  getCurrentProfileId,
} from "./availability.api";

import {
  AvailabilityRule,
  AvailabilityFormPayload,
} from "../model/availability.types";

import { format } from "date-fns";

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

/**
 * Create availability rule from form payload.
 *
 * IMPORTANT:
 * - Slot generation is automatic via DB trigger
 * - This function ONLY inserts availability_rules
 */
export async function createAvailabilityFromForm(
  profileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule> {
  const rulePayload: Omit<
    AvailabilityRule,
    "id" | "created_at" | "updated_at"
  > = {
    profile_id: profileId,
    start_date: format(payload.start_date, "yyyy-MM-dd"),
    start_time: `${payload.start_time}:00`,
    end_time: `${payload.end_time}:00`,
    repeat_type: payload.repeat_type,
    repeat_days: payload.repeat_days ?? null,
    repeat_end_date:
      payload.repeat_type === "none"
        ? null
        : format(payload.repeat_end_date!, "yyyy-MM-dd"),
  };

  return createAvailabilityRule(rulePayload);
}

// ============================================================================
// BATCH CREATE (CONFIGURATION LEVEL)
// ============================================================================

/**
 * Batch create availability rules.
 *
 * NOTE:
 * - This creates multiple RULES
 * - Each rule independently triggers slot generation via DB
 * - This is configuration logic, NOT slot logic
 *
 * PERFORMANCE NOTE:
 * - This is chatty (N inserts)
 * - Acceptable for now
 * - Can be optimized later via bulk insert or RPC
 */
export async function batchCreateAvailabilityRules(
  profileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule[]> {
  const start = payload.start_date;
  const end = payload.repeat_end_date ?? payload.start_date;

  const rules: AvailabilityRule[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const singleDayPayload: AvailabilityFormPayload = {
      ...payload,
      start_date: new Date(cursor),
      repeat_type: "none",
    };

    const rule = await createAvailabilityFromForm(
      profileId,
      singleDayPayload
    );

    rules.push(rule);
    cursor.setDate(cursor.getDate() + 1);
  }

  return rules;
}

// ============================================================================
// EDIT OPERATIONS (DELETE + CREATE)
// ============================================================================

/**
 * Edit availability rule.
 *
 * IMPORTANT:
 * - Old rule is deleted
 * - Slots removed via ON DELETE CASCADE
 * - New rule is created
 * - Slots regenerated automatically via DB trigger
 */
export async function editAvailabilityRule(
  ruleId: string,
  profileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule> {
  await deleteAvailabilityRule(ruleId);

  return createAvailabilityFromForm(profileId, payload);
}

/**
 * Replace all availability rules in a date range.
 *
 * Used for:
 * - Presets
 * - Bulk overrides
 *
 * IMPORTANT:
 * - Deletes rules first
 * - Slots auto-deleted
 * - New rules inserted
 * - Slots auto-generated
 */
export async function replaceAvailabilityInRange(
  profileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule[]> {
  const startDate = format(payload.start_date, "yyyy-MM-dd");
  const endDate = format(
    payload.repeat_end_date ?? payload.start_date,
    "yyyy-MM-dd"
  );

  await deleteAvailabilityRulesInRange(profileId, startDate, endDate);

  return batchCreateAvailabilityRules(profileId, payload);
}

// ============================================================================
// DELETE OPERATIONS
// ============================================================================

/**
 * Delete a single availability rule.
 *
 * Slots are removed automatically via ON DELETE CASCADE.
 */
export async function deleteAvailability(
  ruleId: string
): Promise<void> {
  await deleteAvailabilityRule(ruleId);
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Fetch availability rules for UI display and editing.
 *
 * NOTE:
 * - Slots are fetched separately from availability_slots
 * - This function NEVER returns slots
 */
export async function fetchAvailabilityRules(
  profileId: string
): Promise<AvailabilityRule[]> {
  return getAvailabilityRules(profileId);
}

// ============================================================================
// PROFILE RESOLUTION
// ============================================================================

/**
 * Resolve profile id for current user.
 */
export async function resolveProfileId(
  profileId: string
): Promise<string> {
  if (profileId === "current-user") {
    const resolved = await getCurrentProfileId();
    if (!resolved) {
      throw new Error("No authenticated user found");
    }
    return resolved;
  }
  return profileId;
}
