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

import { fetchScopedContractBasis } from "./contract-basis.api";
import type { AvailabilityScopeRef } from "../domain/contract-basis";

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

export const FT_AVAILABILITY_ERROR =
  "Availability is contract based for Full Time employees. Use Leave Management for unavailability.";

/**
 * Reject the write if this profile is Full-Time, and return the resolved id.
 *
 * CALL THIS BEFORE ANY DESTRUCTIVE STEP. `editAvailabilityRule` and
 * `replaceAvailabilityInRange` both delete before they create, so a guard that
 * only fired inside the create would delete an FT's rules and then throw —
 * destroying data on the path whose whole purpose is to refuse the write.
 *
 * FAILS OPEN, DELIBERATELY. `fetchContractBasis` returns the empty basis on a
 * read error, and that basis is not Full-Time — so a transient contract-read
 * failure lets the write through to
 * `trg_prevent_ft_availability_rule` (20260817120000), which is the real
 * enforcement point and cannot be bypassed from the client. Failing CLOSED here
 * would instead block every casual from declaring availability whenever the
 * contract read is briefly unavailable, which is the worse outcome: it stops
 * legitimate work for the 101 casuals to guard 17 full-timers the database
 * already guards.
 */
async function assertCanDeclareFor(
  profileId: string,
  subDepartmentId?: string | null
): Promise<string> {
  const resolvedProfileId = await resolveProfileId(profileId);
  const scope: AvailabilityScopeRef = { subDepartmentId: subDepartmentId ?? null };
  const basis = await fetchScopedContractBasis(resolvedProfileId, scope);
  // `isFullTime` IS `contractType === 'FT'` (see domain/contract-basis.ts), so
  // one test is the whole test.
  //
  // SCOPED, so the question is "is THIS JOB Full-Time" rather than "does this
  // person hold a Full-Time contract anywhere". An UNSCOPED write still asks
  // the person-wide question, because `resolveScopedBasis` treats a null
  // sub-department as every contract — the same NULL branch
  // `sm_holds_active_ft_contract_in` uses in SQL. Those two must agree or the
  // page offers a declaration the database then refuses.
  if (basis.isFullTime) throw new Error(FT_AVAILABILITY_ERROR);
  return resolvedProfileId;
}

/**
 * Create availability rule from form payload.
 *
 * IMPORTANT:
 * - Full-Time employees cannot create availability rules (contract-based availability)
 * - Slot generation is automatic via DB trigger
 * - This function ONLY inserts availability_rules
 */
export async function createAvailabilityFromForm(
  profileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule> {
  const resolvedProfileId = await assertCanDeclareFor(
    profileId,
    payload.sub_department_id
  );
  return insertRuleFromForm(resolvedProfileId, payload);
}

/**
 * The insert itself, on an ALREADY-resolved and already-guarded profile id.
 *
 * Split out so the batch path can check the contract ONCE. It used to call
 * `createAvailabilityFromForm` per day, which re-resolved the profile and re-read
 * the contract on every iteration — and `fetchContractBasis` may itself issue two
 * selects (the envelope columns, then a base-column retry). A 90-day preset ran
 * ~360 queries to perform 90 inserts.
 */
async function insertRuleFromForm(
  resolvedProfileId: string,
  payload: AvailabilityFormPayload
): Promise<AvailabilityRule> {
  const rulePayload: Omit<
    AvailabilityRule,
    "id" | "created_at" | "updated_at"
  > = {
    profile_id: resolvedProfileId,
    start_date: format(payload.start_date, "yyyy-MM-dd"),
    start_time: `${payload.start_time}:00`,
    end_time: `${payload.end_time}:00`,
    repeat_type: payload.repeat_type,
    repeat_days: payload.repeat_days ?? null,
    repeat_end_date:
      payload.repeat_type === "none"
        ? null
        : format(payload.repeat_end_date!, "yyyy-MM-dd"),
    // Undefined becomes an explicit null: an unscoped rule covers every job,
    // which is the pre-scoping behaviour and what the database guards read a
    // null as. Never omit the key — a missing column and a null column mean the
    // same thing here only by luck.
    sub_department_id: payload.sub_department_id ?? null,
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
  // Resolved and guarded ONCE for the whole range — see `insertRuleFromForm`.
  const resolvedProfileId = await assertCanDeclareFor(
    profileId,
    payload.sub_department_id
  );

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

    const rule = await insertRuleFromForm(resolvedProfileId, singleDayPayload);

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
  // BEFORE the delete. This is delete-then-create with no transaction, so a
  // guard that fired after the delete would take the rule away and put nothing
  // back.
  const resolvedProfileId = await assertCanDeclareFor(
    profileId,
    payload.sub_department_id
  );

  await deleteAvailabilityRule(ruleId);

  return insertRuleFromForm(resolvedProfileId, payload);
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
  // BEFORE the range delete — same reasoning as `editAvailabilityRule`, with a
  // wider blast radius: this one clears every rule in the range.
  const resolvedProfileId = await assertCanDeclareFor(
    profileId,
    payload.sub_department_id
  );

  const startDate = format(payload.start_date, "yyyy-MM-dd");
  const endDate = format(
    payload.repeat_end_date ?? payload.start_date,
    "yyyy-MM-dd"
  );

  // SCOPED, and this is the line where getting it wrong is unrecoverable:
  // replacing a Set-up preset must not delete the same person's Front of House
  // declarations. An unscoped call still clears the range across every job,
  // which is what an unscoped replace means.
  await deleteAvailabilityRulesInRange(
    resolvedProfileId,
    startDate,
    endDate,
    payload.sub_department_id
  );

  return batchCreateAvailabilityRules(resolvedProfileId, payload);
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
