/**
 * RPC Contract Registry — Zod schemas for every Supabase RPC.
 *
 * This is the single source of truth for what the database is expected
 * to return. The TypeScript code never uses `as any` or `as unknown as T`
 * — every RPC response flows through one of these schemas at runtime.
 *
 * Schema naming convention:  <RpcName>ResponseSchema
 * Type   naming convention:  <RpcName>Response
 *
 * When adding a new RPC:
 *  1. Add the output schema here
 *  2. Export the inferred TypeScript type
 *  3. Use callRpc(name, params, schema) in shifts.commands.ts
 */

import { z } from 'zod';

// ── Primitives ─────────────────────────────────────────────────────────────

export const UuidSchema = z.string().uuid();
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const TimeStringSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM[:SS]');

// ── Enum schemas — exact mirror of DB enum values ──────────────────────────

const LifecycleStatusSchema = z.enum([
  'Draft', 'Published', 'InProgress', 'Completed', 'Cancelled',
]);

const AssignmentStatusSchema = z.enum(['assigned', 'unassigned']);

// assignment_outcome only ever holds NULL, 'confirmed', or 'no_show'.
// All other values ('pending', 'offered', 'emergency_assigned', 'declined',
// 'withdrawn', 'cancelled') are banned by the DB check constraint.
const AssignmentOutcomeSchema = z.enum([
  'confirmed', 'no_show',
]).nullable();

const BiddingStatusSchema = z.enum([
  'not_on_bidding', 'on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner',
]);

// TradeApproved has no corresponding FSM state — the FSM uses TradeAccepted (S10)
// as the manager-approval step. TradeApproved is retained here only for backward
// compatibility with existing DB rows during migration; treat it as TradeAccepted.
const TradingStatusSchema = z.enum([
  'NoTrade', 'TradeRequested', 'TradeAccepted', 'TradeApproved',
]);

const AttendanceStatusSchema = z.enum([
  'unknown', 'checked_in', 'no_show', 'late', 'excused',
]);

const FulfillmentStatusSchema = z.enum([
  'scheduled', 'bidding', 'offered', 'none',
]);

// ── Shift state ID (resolved by shiftStateMachine) ────────────────────────


// ── Shift core schema — the DB canonical representation ───────────────────
// Note: We use .passthrough() so that unknown columns (joined relations)
// don't fail validation — they're just passed through as-is.

const ShiftCoreSchema = z.object({
  id: UuidSchema,
  roster_id: UuidSchema,
  organization_id: UuidSchema.nullable(),
  department_id: UuidSchema,
  sub_department_id: UuidSchema.nullable(),
  role_id: UuidSchema.nullable(),
  remuneration_level: z.number().nullable(),
  assigned_employee_id: UuidSchema.nullable(),
  roster_subgroup_id: UuidSchema,
  created_by_user_id: UuidSchema.nullable(),

  // Canonical time columns (timestamptz)
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  tz_identifier: z.string().nullable(),

  // Legacy time columns — retained for backward compat (deprecated)
  shift_date: DateStringSchema.nullable().optional(),
  start_time: TimeStringSchema.nullable().optional(),
  end_time: TimeStringSchema.nullable().optional(),

  // Breaks
  paid_break_minutes: z.number().int().min(0),
  unpaid_break_minutes: z.number().int().min(0),
  break_minutes: z.number().int().min(0).optional(),

  // State machine dimensions
  lifecycle_status: LifecycleStatusSchema,
  assignment_status: AssignmentStatusSchema,
  assignment_outcome: AssignmentOutcomeSchema,
  bidding_status: BiddingStatusSchema,
  trading_status: TradingStatusSchema,
  attendance_status: AttendanceStatusSchema,
  fulfillment_status: FulfillmentStatusSchema,

  // Flags
  is_overnight: z.boolean(),
  is_cancelled: z.boolean(),
  is_from_template: z.boolean(),
  is_locked: z.boolean().nullable().optional(),
  is_draft: z.boolean().nullable().optional(),

  // Metadata
  version: z.number().int(),
  notes: z.string().nullable(),
  tags: z.array(z.string()).nullable().optional(),
  required_skills: z.array(z.unknown()).nullable().optional(),
  required_licenses: z.array(z.unknown()).nullable().optional(),

  created_at: z.string(),
  updated_at: z.string(),
}).passthrough(); // allow joined relation fields through without failure


// ── RPC Response schemas ───────────────────────────────────────────────────

// sm_create_shift / sm_update_shift
// Note: These return primitives in the DB, but the frontend command layer
// will fetch the full row to satisfy the Shift entity interface.
export const CreateShiftResponseSchema = z.string().uuid();

// sm_publish_shift
export const PublishShiftResponseSchema = z.object({
  success: z.boolean(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  error: z.string().optional(),
});

// sm_bulk_publish_shifts
export const BulkPublishResponseSchema = z.object({
  success: z.boolean().optional(),
  total_requested: z.number().int().optional(),
  success_count: z.number().int().optional(),
  failure_count: z.number().int().optional(),
  message: z.string().optional(),
  /** Set on `success: false` — the RPC's EXCEPTION handler returns SQLERRM here. */
  error: z.string().optional(),
  /** Shifts whose version no longer matched `p_expected_versions` — not published. */
  stale_ids: z.array(z.string()).optional(),
  errors: z.array(z.object({
    shift_id: z.string(),
    reason: z.string(),
  })).optional(),
}).passthrough();



// sm_bulk_assign_atomic
const BulkAssignAtomicPerEmployeeSchema = z.object({
  employee_id: z.string().uuid(),
  committed: z.number().int(),
  conflicts: z.array(z.string().uuid()),
});

export const BulkAssignAtomicResponseSchema = z.object({
  success: z.boolean(),
  total_requested: z.number().int().optional(),
  success_count: z.number().int().optional(),
  conflict_count: z.number().int().optional(),
  conflicts: z.array(z.string().uuid()).optional(),
  per_employee: z.array(BulkAssignAtomicPerEmployeeSchema).optional(),
  error: z.string().optional(),
});
export type BulkAssignAtomicResponse = z.infer<typeof BulkAssignAtomicResponseSchema>;

// sm_bulk_delete_shifts
export const BulkDeleteResponseSchema = z.object({
  success: z.boolean(),
  total_requested: z.number().int().optional(),
  success_count: z.number().int(),
  failure_count: z.number().int().optional(),
  /** Per item: which were deleted, and why each other one was refused. */
  deleted_ids: z.array(z.string().uuid()).optional(),
  failed: z.array(z.object({ id: z.string().uuid(), reason: z.string() })).optional(),
  error: z.string().optional(),
});


export const DeleteShiftResponseSchema = z.object({
  success: z.boolean(),
  shift_id: z.string().uuid().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

// sm_manager_cancel
export const CancelShiftResponseSchema = z.object({
  success: z.boolean(),
  new_status: z.string().optional(),
  message: z.string().optional(),
});

// sm_accept_offer / sm_reject_offer
export const OfferActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// sm_request_trade
export const RequestTradeResponseSchema = z.object({
  success: z.boolean(),
  trade_id: z.string().optional(),
});

// sm_employee_drop_shift
export const EmployeeDropResponseSchema = z.object({
  success: z.boolean(),
  new_bidding_status: z.string().optional(),
  hours_to_start: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// sm_close_bidding
export const CloseBiddingResponseSchema = z.object({
  success: z.boolean(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  error: z.string().optional(),
});

// sm_apply_shift_op — the optimistic-concurrency mutation gateway.
// Returns a jsonb envelope: ok + a discriminating `code`. The shape varies by
// code (VERSION_CONFLICT carries current_version/server_row, WRITE_REJECTED a
// note, etc.) so we keep most fields optional + passthrough.
const ApplyShiftOpCodeSchema = z.enum([
  'APPLIED',
  'IDEMPOTENT_REPLAY',
  'VERSION_CONFLICT',
  'ILLEGAL_TRANSITION',
  'WRITE_REJECTED',
  'GONE',
  'FORBIDDEN',
  'ERROR',
]);

export const ApplyShiftOpResponseSchema = z.object({
  ok: z.boolean(),
  code: ApplyShiftOpCodeSchema,
  version: z.number().int().optional(),
  state: z.string().optional(),
  note: z.string().nullable().optional(),
  // WRITE_REJECTED with note EBA_COMPLIANCE_BREACH: the rule broken and why.
  rule_id: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  error: z.string().optional(),
  // VERSION_CONFLICT extras
  current_version: z.number().int().optional(),
  current_state: z.string().optional(),
  attempted: z.string().optional(),
}).passthrough();

// Compliance RPCs

// apply_template_to_date_range_v2
const ApplyTemplateResponseSchema = z.object({
  success: z.boolean(),
  shifts_created: z.number().int(),
  batch_id: UuidSchema.optional(),
  roster_id: UuidSchema.optional(),
  error: z.string().optional(),
});
