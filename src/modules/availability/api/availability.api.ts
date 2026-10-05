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

/**
 * Fetch a single availability rule by ID.
 */
export async function getAvailabilityRule(
  ruleId: string
): Promise<AvailabilityRule | null> {
  const { data, error } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data as AvailabilityRule;
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

/**
 * @deprecated
 * Direct updates are forbidden.
 * Editing MUST use delete + create.
 */
export async function updateAvailabilityRule(): Promise<never> {
  throw new Error(
    "Direct updates are not allowed. Use delete + create pattern."
  );
}

// ============================================================================
// DELETE (RULES)
// ============================================================================

/**
 * Delete a single availability rule.
 * Slots are removed automatically via ON DELETE CASCADE.
 */
export async function deleteAvailabilityRule(ruleId: string): Promise<void> {
  const { error } = await supabase
    .from("availability_rules")
    .delete()
    .eq("id", ruleId);

  if (error) throw error;
}

/**
 * Does this rule cover any day in [startDate, endDate]?
 *
 * Pulled out as a pure function because the predicate is genuinely subtle and
 * was previously wrong in a way no type could catch — see
 * `deleteAvailabilityRulesInRange`.
 *
 * A NON-REPEATING rule covers exactly ONE day: its `start_date`. Its
 * `repeat_end_date` is null, and reading that null as "runs forever" is what
 * makes a range delete eat every single-day declaration the person ever made,
 * including ones years outside the range being replaced.
 *
 * A REPEATING rule runs from `start_date` to `repeat_end_date`, and there a
 * null genuinely does mean open-ended.
 */
export function ruleOverlapsRange(
  rule: Pick<AvailabilityRule, "start_date" | "repeat_type" | "repeat_end_date">,
  startDate: string,
  endDate: string
): boolean {
  if (rule.start_date > endDate) return false;
  const effectiveEnd =
    rule.repeat_type === "none"
      ? rule.start_date
      : rule.repeat_end_date ?? "9999-12-31";
  return effectiveEnd >= startDate;
}

/**
 * Delete every rule for a profile overlapping a date range, optionally narrowed
 * to ONE JOB. Used by the bulk replace flow.
 *
 * TWO-STEP (select, filter, delete by id) RATHER THAN ONE PREDICATE. This used
 * to be a single `.delete()` filtered with `.gte("end_date", startDate)` — and
 * `availability_rules` HAS NO `end_date` COLUMN. It has `repeat_end_date`.
 * PostgREST rejects the whole statement on an unknown column, so the delete
 * threw every time it ran and `replaceAvailabilityInRange` could never have
 * worked. It was only ever re-exported, never wired to a caller, which is why
 * nobody noticed. The overlap rule cannot be expressed as a flat PostgREST
 * filter anyway (it branches on `repeat_type`), and expressing it as nested
 * `or(and(...))` would put the same subtlety back somewhere no test can reach.
 *
 * Rule counts are tiny — 90 rows across the whole of production, ~1 per person —
 * so the extra round trip costs nothing and buys a predicate that is unit
 * testable.
 */
export async function deleteAvailabilityRulesInRange(
  profileId: string,
  startDate: string,
  endDate: string,
  /** Which job to clear. Omit to clear the range across EVERY job. */
  subDepartmentId?: string | null
): Promise<number> {
  let query = supabase
    .from("availability_rules")
    .select("id,start_date,repeat_type,repeat_end_date")
    .eq("profile_id", profileId)
    .lte("start_date", endDate);

  const filter = scopeFilter(subDepartmentId);
  if (filter) query = query.or(filter);

  const { data, error } = await query;
  if (error) throw error;

  const doomed = ((data ?? []) as AvailabilityRule[])
    .filter((r) => ruleOverlapsRange(r, startDate, endDate))
    .map((r) => r.id);

  if (doomed.length === 0) return 0;

  const { error: delError } = await supabase
    .from("availability_rules")
    .delete()
    .in("id", doomed);

  if (delError) throw delError;
  return doomed.length;
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
