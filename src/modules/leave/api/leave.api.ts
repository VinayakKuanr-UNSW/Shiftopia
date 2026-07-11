/**
 * Leave API — Supabase client layer for balances + requests.
 *
 * Reads from `leave_balances` (new table) and `leave_requests` (enhanced).
 * All mutations validate business rules before writing.
 */

import { supabase } from '@/platform/supabase/client';
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveRequestStatus,
  CreateLeaveRequestInput,
  LeaveTypeCode,
} from '../model/leave.types';
import { LEAVE_POLICIES } from '../domain/leave-policy';

// ── Balances ─────────────────────────────────────────────────────────────────

/**
 * Fetch all leave balances for an employee.
 */
export async function getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
  const { data, error } = await (supabase as any)
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId);

  if (error) {
    console.error('[leave.api] getLeaveBalances error:', error);
    return [];
  }

  return (data ?? []).map(mapBalanceRow);
}

function mapBalanceRow(row: any): LeaveBalance {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type as LeaveTypeCode,
    balanceHours: Number(row.balance_hours ?? 0),
    accruedHours: Number(row.accrued_hours ?? 0),
    usedHours: Number(row.used_hours ?? 0),
    asOfDate: row.as_of_date ?? row.updated_at?.split('T')[0] ?? '',
  };
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface LeaveRequestFilters {
  status?: LeaveRequestStatus | LeaveRequestStatus[];
  leaveType?: LeaveTypeCode;
  startAfter?: string; // YYYY-MM-DD
  startBefore?: string;
}

/**
 * Fetch leave requests for one employee with optional filters.
 */
export async function getLeaveRequests(
  employeeId: string,
  filters?: LeaveRequestFilters,
): Promise<LeaveRequest[]> {
  let query = (supabase as any)
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    query = query.in('status', statuses);
  }
  if (filters?.leaveType) query = query.eq('leave_type', filters.leaveType);
  if (filters?.startAfter) query = query.gte('start_date', filters.startAfter);
  if (filters?.startBefore) query = query.lte('start_date', filters.startBefore);

  const { data, error } = await query;
  if (error) {
    console.error('[leave.api] getLeaveRequests error:', error);
    return [];
  }
  return (data ?? []).map(mapRequestRow);
}

/**
 * Fetch all pending leave requests for a team (manager view).
 */
export async function getTeamLeaveRequests(
  filters?: LeaveRequestFilters & { departmentId?: string },
): Promise<LeaveRequest[]> {
  let query = (supabase as any)
    .from('leave_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    query = query.in('status', statuses);
  } else {
    query = query.eq('status', 'pending');
  }
  if (filters?.startAfter) query = query.gte('start_date', filters.startAfter);
  if (filters?.startBefore) query = query.lte('start_date', filters.startBefore);

  const { data, error } = await query;
  if (error) {
    console.error('[leave.api] getTeamLeaveRequests error:', error);
    return [];
  }
  return (data ?? []).map(mapRequestRow);
}

function mapRequestRow(row: any): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type as LeaveTypeCode,
    startDate: row.start_date?.split('T')[0] ?? '',
    endDate: row.end_date?.split('T')[0] ?? '',
    requestedHours: Number(row.requested_hours ?? 0),
    reason: row.reason,
    certificateUrl: row.certificate_url ?? null,
    status: row.status as LeaveRequestStatus,
    approvedBy: row.approved_by,
    approvalDate: row.approval_date,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Roster conflicts ─────────────────────────────────────────────────────────

/** A rostered shift that overlaps an (approved) leave range. */
export interface LeaveShiftConflict {
  shiftId: string;
  shiftDate: string;
  startTime: string | null;
  endTime: string | null;
  lifecycleStatus: string | null;
}

/**
 * Find shifts still assigned to an employee within a leave date range.
 * Approving leave does NOT unassign these — surface them so the manager can
 * unassign/re-offer from the roster (otherwise the employee is later falsely
 * marked No-Show).
 *
 * Dates are YYYY-MM-DD (inclusive). Excludes cancelled and soft-deleted shifts.
 */
export async function getLeaveShiftConflicts(
  employeeId: string,
  startDate: string,
  endDate: string,
): Promise<LeaveShiftConflict[]> {
  const { data, error } = await (supabase as any)
    .from('shifts')
    .select('id, shift_date, start_time, end_time, lifecycle_status')
    .eq('assigned_employee_id', employeeId)
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .neq('lifecycle_status', 'Cancelled')
    .is('deleted_at', null)
    .order('shift_date', { ascending: true });

  if (error) {
    console.error('[leave.api] getLeaveShiftConflicts error:', error);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    shiftId: row.id,
    shiftDate: row.shift_date?.split('T')[0] ?? '',
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    lifecycleStatus: row.lifecycle_status ?? null,
  }));
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface MutationResult<T = void> {
  data?: T;
  error?: string;
}

/**
 * Create a leave request (status='pending'). Validates balance sufficiency for
 * balance-tracked leave types.
 */
export async function createLeaveRequest(
  employeeId: string,
  input: CreateLeaveRequestInput,
): Promise<MutationResult<LeaveRequest>> {
  const policy = LEAVE_POLICIES[input.leaveType];
  if (!policy) return { error: `Unknown leave type: ${input.leaveType}` };

  // Balance check for tracked types. For 'carer', check 'personal' balance.
  const balanceTypeToCheck = input.leaveType === 'carer' ? 'personal' : input.leaveType;
  const policyToCheck = LEAVE_POLICIES[balanceTypeToCheck];

  if (policyToCheck?.balanceTracked) {
    const balances = await getLeaveBalances(employeeId);
    const bal = balances.find((b) => b.leaveType === balanceTypeToCheck);
    if (!bal || bal.balanceHours < input.requestedHours) {
      return { error: `Insufficient ${balanceTypeToCheck} balance: ${bal?.balanceHours ?? 0}h available, ${input.requestedHours}h requested` };
    }
  }

  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      requested_hours: input.requestedHours,
      reason: input.reason ?? null,
      certificate_url: input.certificateUrl ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { data: mapRequestRow(data) };
}

/**
 * Approve a leave request. Updates status, records approver, and deducts balance.
 *
 * Also returns any shifts still rostered to the employee inside the leave
 * range (`conflictingShifts`) so the caller can warn the manager that they
 * need unassigning/re-offering. The approval itself succeeds even if the
 * conflict lookup fails (empty list is returned in that case).
 */
export async function approveLeaveRequest(
  requestId: string,
  approverId: string,
): Promise<MutationResult<{ conflictingShifts: LeaveShiftConflict[] }>> {
  const { data: req, error: fetchErr } = await (supabase as any)
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (fetchErr || !req) return { error: fetchErr?.message ?? 'Request not found' };
  if (req.status !== 'pending') return { error: `Cannot approve a ${req.status} request` };
  if (req.employee_id === approverId) return { error: 'Cannot approve your own leave request' };

  // Update request status.
  const { error: updateErr } = await (supabase as any)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approval_date: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (updateErr) return { error: updateErr.message };

  // The DB trigger `trg_leave_balance_deduction` will atomically deduct the balance.

  // Roster-conflict check — best-effort: approval has already succeeded, so
  // never let a conflict-lookup failure surface as an approval error.
  let conflictingShifts: LeaveShiftConflict[] = [];
  try {
    conflictingShifts = await getLeaveShiftConflicts(
      req.employee_id,
      req.start_date?.split('T')[0] ?? '',
      req.end_date?.split('T')[0] ?? '',
    );
  } catch (e) {
    console.error('[leave.api] post-approval conflict check failed:', e);
  }

  return { data: { conflictingShifts } };
}

/**
 * Reject a leave request with an optional reason.
 */
export async function rejectLeaveRequest(
  requestId: string,
  approverId: string,
  reason?: string,
): Promise<MutationResult> {
  const { error } = await (supabase as any)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approval_date: new Date().toISOString(),
      rejection_reason: reason ?? null,
    })
    .eq('id', requestId)
    .eq('status', 'pending'); // guard: only pending can be rejected

  if (error) return { error: error.message };
  return {};
}

/**
 * Cancel a leave request (only if still pending).
 */
export async function cancelLeaveRequest(requestId: string): Promise<MutationResult> {
  const { error } = await (supabase as any)
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) return { error: error.message };
  return {};
}

export interface UnassignConflictsResult {
  /** How many shift IDs were submitted for unassignment. */
  attempted: number;
  /** How many actually transitioned to unassigned (the rest were skipped). */
  succeeded: number;
}

/**
 * Unassign the shifts that overlap an approved leave range (the ones surfaced
 * by `getLeaveShiftConflicts`). Routes through the audited shift-mutation
 * gateway (`sm_apply_shift_op` via `bulkUnassignShifts`), so each removal is
 * version-checked, FSM-guarded and recorded as a durable UNASSIGNED
 * shift_event naming the removed worker — never a raw table write.
 *
 * Partial success is normal: a shift already reassigned/cancelled by another
 * user (version conflict, illegal transition) is skipped, not fatal, so
 * `succeeded` may be less than `attempted`.
 */
export async function unassignConflictingShifts(
  shiftIds: string[],
): Promise<MutationResult<UnassignConflictsResult>> {
  if (shiftIds.length === 0) return { data: { attempted: 0, succeeded: 0 } };
  try {
    const updated = await shiftsCommands.bulkUnassignShifts(shiftIds);
    return { data: { attempted: shiftIds.length, succeeded: updated.length } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to unassign shifts' };
  }
}
