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

