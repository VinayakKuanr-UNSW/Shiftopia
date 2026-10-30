/**
 * Availability API Layer – Phase-3 (Slots Are Authoritative)
 *
 * RESPONSIBILITIES:
 * - Raw Supabase queries only
 * - CRUD on availability_rules
 * - READ-ONLY access to availability_slots
 *
 * MUST NOT:
 * - Expand rules into slots
 * - Perform recurrence logic
 * - Manage state
 * - Trigger Edge Functions
 * - Contain UI or layout logic
 */

import { supabase } from "@/platform/supabase/client";
import { assertWrote } from '@/platform/supabase/writes';
import {
  AvailabilityRule,
  AvailabilitySlot,
} from "../model/availability.types";

// ============================================================================
// SCOPE
// ============================================================================

/**
 * The PostgREST filter for "declarations that bear on this job".
 *
 * `sub_department_id.eq.X,sub_department_id.is.null` — the scoped declarations
 * PLUS the unscoped ones, which cover every job by definition. The OR-NULL half
 * is not optional: 85 of the 90 production rules are scoped and the remaining
 * five deliberately are not (one employee genuinely spans two sub-departments,
 * four hold no contract at all), so dropping NULLs would silently un-declare
 * those people rather than narrowing them.
 *
 * Returns null for an unscoped read, which every caller treats as "no filter" —
 * i.e. the person-wide answer, which is what this module did before scoping and
 * what any caller that has not resolved a job still gets.
 */
export function scopeFilter(subDepartmentId?: string | null): string | null {
  return subDepartmentId
    ? `sub_department_id.eq.${subDepartmentId},sub_department_id.is.null`
    : null;
}

// ============================================================================
// CREATE (RULES)
// ============================================================================

export async function createAvailabilityRule(
  rule: Omit<AvailabilityRule, "id" | "created_at" | "updated_at">
): Promise<AvailabilityRule> {
  const { data, error } = await supabase
    .from("availability_rules")
    .insert(rule)
    .select()
    .single();

  if (error) throw error;
  return data as AvailabilityRule;
}

// ============================================================================
// READ (RULES – EDITING ONLY)
// ============================================================================

/**
 * Fetch availability rules for a profile.
 * Used ONLY for listing and editing rules.
 */
export async function getAvailabilityRules(
  profileId: string,
  /** Which job. Omit for the person-wide list. See `scopeFilter`. */
  subDepartmentId?: string | null
): Promise<AvailabilityRule[]> {
  let query = supabase
    .from("availability_rules")
    .select("*")
    .eq("profile_id", profileId);

  const filter = scopeFilter(subDepartmentId);
  if (filter) query = query.or(filter);

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) throw error;
  return (data as AvailabilityRule[]) ?? [];
}


// ============================================================================
// READ (SLOTS – CALENDAR & SCHEDULER)
// ============================================================================

/**
 * Fetch availability slots for calendar rendering.
 *
 * IMPORTANT:
 * - Slots are authoritative
 * - No rule expansion here
 * - No recurrence logic
 */
export async function getAvailabilitySlots(
  profileId: string,
  startDate: string, // yyyy-MM-dd
  endDate: string, // yyyy-MM-dd
  /** Which job. Omit for the person-wide list. See `scopeFilter`. */
  subDepartmentId?: string | null
): Promise<AvailabilitySlot[]> {
  let query = supabase
    .from("availability_slots")
    .select("*")
    .eq("profile_id", profileId)
    .gte("slot_date", startDate)
    .lte("slot_date", endDate);

  const filter = scopeFilter(subDepartmentId);
  if (filter) query = query.or(filter);

  const { data, error } = await query
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return (data as AvailabilitySlot[]) ?? [];
}

// ============================================================================
// UPDATE (DISALLOWED)
// ============================================================================


// ============================================================================
// DELETE (RULES)
// ============================================================================

/**
 * Delete a single availability rule.
 * Slots are removed automatically via ON DELETE CASCADE.
 */
export async function deleteAvailabilityRule(ruleId: string): Promise<void> {
  const removed = await supabase
    .from("availability_rules")
    .delete({ count: "exact" })
    .eq("id", ruleId);

  if (removed.error) throw removed.error;
  assertWrote(removed, "remove this availability rule");
}



// ============================================================================
// AUTH HELPERS
// ============================================================================

/**
 * Resolve the current user's profile ID.
 */
export async function getCurrentProfileId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}
