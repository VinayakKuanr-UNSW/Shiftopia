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
export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const TimeStringSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM[:SS]');

// ── Enum schemas — exact mirror of DB enum values ──────────────────────────

export const LifecycleStatusSchema = z.enum([
  'Draft', 'Published', 'InProgress', 'Completed', 'Cancelled',
]);

export const AssignmentStatusSchema = z.enum(['assigned', 'unassigned']);

export const AssignmentOutcomeSchema = z.enum([
  'pending', 'offered', 'confirmed', 'emergency_assigned',
]).nullable();

export const BiddingStatusSchema = z.enum([
  'not_on_bidding', 'on_bidding_normal', 'on_bidding_urgent', 'bidding_closed_no_winner',
]);

export const TradingStatusSchema = z.enum([
  'NoTrade', 'TradeRequested', 'TradeAccepted', 'TradeApproved',
]);

export const AttendanceStatusSchema = z.enum([
  'unknown', 'checked_in', 'no_show', 'late', 'excused',
]);

export const FulfillmentStatusSchema = z.enum([
  'scheduled', 'bidding', 'offered', 'none',
]);

// ── Shift state ID (resolved by shiftStateMachine) ────────────────────────

export const ShiftStateIDSchema = z.enum([
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
  'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'UNKNOWN',
]);

// ── Shift core schema — the DB canonical representation ───────────────────
// Note: We use .passthrough() so that unknown columns (joined relations)
// don't fail validation — they're just passed through as-is.

export const ShiftCoreSchema = z.object({
  id: UuidSchema,
  roster_id: UuidSchema,
  organization_id: UuidSchema.nullable(),
  department_id: UuidSchema,
  sub_department_id: UuidSchema.nullable(),
  role_id: UuidSchema.nullable(),
  remuneration_level_id: UuidSchema.nullable(),
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

export type ShiftCore = z.infer<typeof ShiftCoreSchema>;

// ── RPC Response schemas ───────────────────────────────────────────────────

// sm_create_shift / sm_update_shift
// Note: These return primitives in the DB, but the frontend command layer
// will fetch the full row to satisfy the Shift entity interface.
export const CreateShiftResponseSchema = z.string().uuid();
export const UpdateShiftResponseSchema = z.boolean();
export type CreateShiftResponse = z.infer<typeof CreateShiftResponseSchema>;
export type UpdateShiftResponse = z.infer<typeof UpdateShiftResponseSchema>;

// sm_publish_shift
export const PublishShiftResponseSchema = z.object({
  success: z.boolean(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  error: z.string().optional(),
});
export type PublishShiftResponse = z.infer<typeof PublishShiftResponseSchema>;

// sm_bulk_publish_shifts
export const BulkPublishResponseSchema = z.object({
  success: z.boolean(),
  total_requested: z.number().int(),
  success_count: z.number().int(),
  failure_count: z.number().int(),
  message: z.string().optional(),
  errors: z.array(z.object({
    shift_id: z.string(),
    reason: z.string(),
  })).optional(),
});
export type BulkPublishResponse = z.infer<typeof BulkPublishResponseSchema>;

// sm_bulk_assign
export const BulkAssignResponseSchema = z.object({
  success: z.boolean(),
  total_requested: z.number().int(),
  success_count: z.number().int(),
  failure_count: z.number().int(),
  message: z.string().optional(),
});
export type BulkAssignResponse = z.infer<typeof BulkAssignResponseSchema>;

// sm_bulk_delete_shifts
export const BulkDeleteResponseSchema = z.object({
  success: z.boolean(),
  total_requested: z.number().int().optional(),
  success_count: z.number().int(),
  failure_count: z.number().int().optional(),
  error: z.string().optional(),
});
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

// delete_shift_with_audit → boolean
export const DeleteShiftResponseSchema = z.boolean();
export type DeleteShiftResponse = z.infer<typeof DeleteShiftResponseSchema>;

// sm_manager_cancel
export const CancelShiftResponseSchema = z.object({
  success: z.boolean(),
  new_status: z.string().optional(),
  message: z.string().optional(),
});
export type CancelShiftResponse = z.infer<typeof CancelShiftResponseSchema>;

// sm_accept_offer / sm_reject_offer / sm_decline_offer
export const OfferActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type OfferActionResponse = z.infer<typeof OfferActionResponseSchema>;

// sm_request_trade
export const RequestTradeResponseSchema = z.object({
  success: z.boolean(),
  trade_id: z.string().optional(),
});
export type RequestTradeResponse = z.infer<typeof RequestTradeResponseSchema>;

// sm_employee_drop_shift
export const EmployeeDropResponseSchema = z.object({
  success: z.boolean(),
  new_bidding_status: z.string().optional(),
  hours_to_start: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});
export type EmployeeDropResponse = z.infer<typeof EmployeeDropResponseSchema>;

// sm_close_bidding
export const CloseBiddingResponseSchema = z.object({
  success: z.boolean(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  error: z.string().optional(),
});

// Compliance RPCs
export const OverlapCheckSchema = z.boolean().nullable().transform(v => v ?? false);
export const WeeklyHoursSchema = z.number().nullable().transform(v => v ?? 0);
export const RestPeriodSchema = z.boolean().nullable().transform(v => v ?? true);

// apply_template_to_date_range_v2
export const ApplyTemplateResponseSchema = z.object({
  success: z.boolean(),
  shifts_created: z.number().int(),
  batch_id: UuidSchema.optional(),
  roster_id: UuidSchema.optional(),
  error: z.string().optional(),
});
export type ApplyTemplateResponse = z.infer<typeof ApplyTemplateResponseSchema>;
