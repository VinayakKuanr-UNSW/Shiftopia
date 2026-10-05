/**
 * Leave API — Supabase client layer for balances + requests.
 *
 * Reads from `leave_balances` (new table) and `leave_requests` (enhanced).
 * All mutations validate business rules before writing.
 */

import { supabase } from '@/platform/supabase/client';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { shiftsCommands } from '@/modules/rosters/api/shifts.commands';
import { ELECTION_LEAVE_TYPES } from '../model/leave.types';
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveRequestStatus,
  CreateLeaveRequestInput,
  LeaveTypeCode, LeaveElectionMode,
} from '../model/leave.types';
import { LEAVE_POLICIES } from '../domain/leave-policy';
import type { EmployeeUnit } from '../domain/leave-approval';
import { fetchContractBasis } from '@/modules/availability/api/contract-basis.api';
import { isSecurityRoleName } from '@/modules/compliance/security-role';

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

/**
 * Whether the employee is a Full-Time Security team member (Sch 3 §8) —
 * mirrors the exact join `accrue_leave_balances()` uses server-side:
 * an Active contract with employment_status containing "full" whose role
 * name contains "security". Used to select the role-aware policy table
 * (`getLeavePolicies`) so the UI's accrual-rate display and balance
 * projection match the DB's actual 210h/84h basis instead of always
 * falling back to the general 152h/76h rates (audit H-9).
 */
export async function isFullTimeSecurityEmployee(employeeId: string): Promise<boolean> {
  // BUG THIS FIXES: the contract lookup used `.maybeSingle()`, which ERRORS
  // (PGRST116) as soon as a second Active row exists — and 30 of 103 people in
  // production hold more than one Active contract. Every one of them resolved
  // to `false` and was shown the general 152h/76h accrual instead of Schedule
  // 3's 210h/84h, with no error surfaced anywhere.
  //
  // Resolution now goes through the shared basis reader, so "which of this
  // person's contracts counts" is answered the same way here as it is for the
  // hours rules and the availability page.
  const basis = await fetchContractBasis(employeeId);
  if (basis.isError || basis.contractType !== 'FT' || basis.roleIds.length === 0) return false;

  const { data: roles, error: roleErr } = await (supabase as any)
    .from('roles')
    .select('name')
    .in('id', basis.roleIds);
  if (roleErr || !roles?.length) return false;

  // Any Security role across their Active contracts qualifies — the DB's
  // `accrue_leave_balances()` joins contract to role without deduplicating, so
  // a person holding one Security and one non-Security contract accrues at the
  // Schedule 3 rate there too.
  return roles.some((r: { name?: string | null }) =>
    isSecurityRoleName(r?.name));
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
  /** Requests still running on or after this date (`end_date >= endAfter`). */
  endAfter?: string;
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
 * Leave requests the caller may see as a manager (RLS: `leave.view` /
 * `leave.approve` through the gate). Pending only unless a status is given.
 *
 * NOT filtered by department here. It used to accept a `departmentId` it never
 * applied, so the header scope silently did nothing; scope is now applied by
 * `inScope` against each employee's contracts, which also handles several
 * selected departments rather than the first.
 */
export async function getTeamLeaveRequests(
  filters?: LeaveRequestFilters,
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
  if (filters?.endAfter) query = query.gte('end_date', filters.endAfter);

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
    // Null for every non-election type, and for an election-type request whose
    // choice has not been recorded — see LeaveElectionMode.
    electionMode: (row.election_mode as LeaveElectionMode | null) ?? null,
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
  /**
   * Who the shift was for. Carried because approval now REMOVES the full-time
   * ones and only reports the rest — see `approveLeaveRequest`.
   */
  targetEmploymentType: string | null;
  /**
   * Already worked, or being worked: clocked in, In Progress or Completed.
   * Approval NEVER removes or unassigns these — see `isWorkedShift`.
   */
  worked: boolean;
  /**
   * Its start (Sydney) has passed — worked or not. A started shift is never
   * deleted or unassigned (the database refuses both), so approval keeps and
   * reports it.
   */
  started: boolean;
}

/**
 * Has this shift been (or is it being) worked?
 *
 * Retro-dated leave is normal — sick leave is often applied for the day after —
 * so an approval's date range can cover shifts that were actually worked.
 * `sm_delete_shift` now refuses worked shifts too (20261001170000), but the
 * leave path decides first so they are reported as kept, not as failures: a worked shift carries the
 * clock-in and timesheet that payroll pays from, and deleting it would erase
 * hours the person really worked.
 */
export function isWorkedShift(s: { actualStart: string | null; lifecycleStatus: string | null }): boolean {
  return s.actualStart != null || s.lifecycleStatus === 'InProgress' || s.lifecycleStatus === 'Completed';
}

/**
 * Find shifts still assigned to an employee within a leave date range.
 *
 * Read-only. What is DONE about them is `approveLeaveRequest`'s decision: it
 * deletes the full-time ones (their hours are reconciled against a contracted
 * cycle, and the Office grid shows an approved leave day as closed, so a shift
 * surviving underneath is incoherent) and reports the part-time and casual ones
 * for a manager to unassign or re-offer, which is the behaviour those surfaces
 * have always had.
 *
 * Either way the shift must not simply be left: the employee would be marked
 * No-Show for a day they were approved to be absent.
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
    .select('id, shift_date, start_time, end_time, lifecycle_status, target_employment_type, actual_start')
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
    targetEmploymentType: row.target_employment_type ?? null,
    lifecycleStatus: row.lifecycle_status ?? null,
    worked: isWorkedShift({ actualStart: row.actual_start ?? null, lifecycleStatus: row.lifecycle_status ?? null }),
    started: isWorkedShift({ actualStart: row.actual_start ?? null, lifecycleStatus: row.lifecycle_status ?? null })
      || (Boolean(row.shift_date && row.start_time)
        && parseZonedDateTime(String(row.shift_date).split('T')[0], row.start_time, SYDNEY_TZ).getTime() <= Date.now()),
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

  // NO BALANCE REFUSAL. A request larger than the balance is allowed — leave
  // in advance is the manager's decision (2026-09-30), and the database no
  // longer forbids a negative balance. The request form shows the employee the
  // deficit before they submit; the manager sees it again before approving.
  // (Casual carer's leave never had a balance to check — cl 45.6(c).)

  // Overlap guard (H5) — friendly pre-check for the common case. The DB EXCLUDE
  // constraint `leave_requests_no_overlap` is the authoritative guarantee that
  // also closes the concurrent-submit race. Two ranges overlap (inclusive) iff
  // existing.start <= new.end AND existing.end >= new.start.
  const { data: overlaps } = await (supabase as any)
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved'])
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate)
    .limit(1);
  if (overlaps && overlaps.length > 0) {
    return { error: 'You already have a pending or approved leave request that overlaps these dates.' };
  }

  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      leave_type: input.leaveType,
      // cl 55.1 / cl 58.2 only; the DB CHECK rejects an election on any other
      // type, so it is normalised to null here rather than passed through.
      election_mode: ELECTION_LEAVE_TYPES.includes(input.leaveType)
        ? (input.electionMode ?? null)
        : null,
      start_date: input.startDate,
      end_date: input.endDate,
      requested_hours: input.requestedHours,
      reason: input.reason ?? null,
      certificate_url: input.certificateUrl ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    // 23P01 = exclusion_violation: the overlap constraint fired (lost the race
    // with a concurrent submit). Surface the same friendly message.
    if ((error as { code?: string }).code === '23P01') {
      return { error: 'You already have a pending or approved leave request that overlaps these dates.' };
    }
    return { error: error.message };
  }
  return { data: mapRequestRow(data) };
}

/**
 * Approve a leave request. Updates status, records approver, and deducts balance.
 *
 * REMOVES THE UNWORKED FULL-TIME SHIFTS THE LEAVE COLLIDES WITH, and reports
 * the rest. A shift already worked (clocked in, In Progress, Completed) is never
 * removed or unassigned — it comes back in `keptWorked`.
 *
 * A full-time shift's hours are reconciled against a contracted cycle, and the
 * Office grid renders an approved leave day as closed to rostering — so a
 * full-time shift surviving underneath approved leave is not a warning, it is an
 * incoherent state, and it would later mark the employee No-Show for a day they
 * were approved to be absent. Part-time and casual conflicts are still only
 * REPORTED (`conflictingShifts`), which is the behaviour those surfaces have
 * always had: they are coverage, and who replaces them is a manager's decision.
 *
 * ORDER MATTERS, AND IT IS NOT ATOMIC. The status update lands first and cannot
 * be rolled back from here, so a deletion that fails leaves the leave approved
 * with its shift still in place. That is reported (`removalFailures`) rather than
 * swallowed — the manager can delete it from the grid, which is exactly the
 * conflict state the leave card is built to show. Making the pair atomic needs a
 * database function and is the right eventual home for this.
 *
 * The approval itself still succeeds even if the conflict LOOKUP fails.
 */
export async function approveLeaveRequest(
  requestId: string,
  approverId: string,
): Promise<MutationResult<{
  /** Unworked part-time and casual shifts, for the caller to unassign. */
  conflictingShifts: LeaveShiftConflict[];
  /** Unworked full-time shifts this approval removed. */
  removedShifts: LeaveShiftConflict[];
  /** Unworked full-time shifts it tried and failed to remove. */
  removalFailures: Array<{ conflict: LeaveShiftConflict; reason: string }>;
  /** Shifts inside the leave dates that had already started (worked or not) — left untouched, for the manager to reconcile. */
  keptWorked: LeaveShiftConflict[];
}>> {
  const { data: req, error: fetchErr } = await (supabase as any)
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (fetchErr || !req) return { error: fetchErr?.message ?? 'Request not found' };
  if (req.status !== 'pending') return { error: `Cannot approve a ${req.status} request` };
  if (req.employee_id === approverId) return { error: 'Cannot approve your own leave request' };

  // No balance check: approving past the balance is leave in advance, and the
  // trigger now records the deficit instead of flooring it. The review panel
  // states the resulting balance before the manager presses Approve.

  // Update request status. The `.eq('status','pending')` is the authoritative
  // guard (the fetch-then-check above is only a fast-path and is TOCTOU): under a
  // concurrent approve/cancel/reject the UPDATE matches zero rows, so we never
  // double-deduct balance or resurrect a cancelled/rejected request into approved.
  const { data: updatedRows, error: updateErr } = await (supabase as any)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approval_date: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');

  if (updateErr) return { error: updateErr.message };
  if (!updatedRows || updatedRows.length === 0) {
    return { error: 'This request is no longer pending (it may have just been actioned by someone else).' };
  }

  // The DB trigger `trg_leave_balance_deduction` will atomically deduct the balance.

  // Roster-conflict check — best-effort: approval has already succeeded, so
  // never let a conflict-lookup failure surface as an approval error.
  let allConflicts: LeaveShiftConflict[] = [];
  try {
    allConflicts = await getLeaveShiftConflicts(
      req.employee_id,
      req.start_date?.split('T')[0] ?? '',
      req.end_date?.split('T')[0] ?? '',
    );
  } catch (e) {
    console.error('[leave.api] post-approval conflict check failed:', e);
  }

  // Started shifts are never touched — worked or not, a shift whose start has
  // passed is never deleted or unassigned. The manager decides whether the
  // leave or the shift is wrong.
  const keptWorked = allConflicts.filter(c => c.started);
  const unworked = allConflicts.filter(c => !c.started);
  const fullTime = unworked.filter(c => c.targetEmploymentType === 'FT');
  const conflictingShifts = unworked.filter(c => c.targetEmploymentType !== 'FT');

  const removedShifts: LeaveShiftConflict[] = [];
  const removalFailures: Array<{ conflict: LeaveShiftConflict; reason: string }> = [];

  for (const c of fullTime) {
    try {
      // Through the command, which checks permission and refuses a started or
      // worked shift itself; the `started` filter above keeps those out of this
      // list in the first place, so they are reported, not failed. Permanent.
      await shiftsCommands.deleteShift(c.shiftId);
      removedShifts.push(c);
    } catch (e) {
      removalFailures.push({
        conflict: c,
        reason: e instanceof Error ? e.message : 'The shift could not be deleted.',
      });
    }
  }

  return { data: { conflictingShifts, removedShifts, removalFailures, keptWorked } };
}

/**
 * Reject a leave request. A reason is REQUIRED: it is what the employee reads,
 * and the audit trigger records it against the manager. It used to be the
 * hard-coded "Declined by manager" on every rejection.
 */
export async function rejectLeaveRequest(
  requestId: string,
  approverId: string,
  reason: string,
): Promise<MutationResult> {
  const why = reason.trim();
  if (!why) return { error: 'Give the employee a reason for the rejection.' };

  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approval_date: new Date().toISOString(),
      rejection_reason: why,
    })
    .eq('id', requestId)
    .eq('status', 'pending') // guard: only pending can be rejected
    .select('id');

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'This request is no longer pending (it may have just been actioned by someone else).' };
  }
  return {};
}

/**
 * Revoke APPROVED leave that has not yet ended (manager only — RLS
 * `leave_requests_manager_update`; employees can cancel only while pending).
 *
 * Moves it to `cancelled` with the reason in `rejection_reason`, which the audit
 * trigger records as the event reason against the revoking manager. The
 * balance comes back through `trg_leave_balance_deduction`'s approved→other
 * branch. `approved_by` is left as it was, which is how a revocation is told
 * apart from an employee's withdrawal (see `displayStatus`).
 *
 * WHAT IT DOES NOT UNDO: full-time shifts deleted when the leave was approved
 * stay deleted. The day is open again, and the manager re-rosters it.
 */
export async function revokeLeaveRequest(
  requestId: string,
  reason: string,
  today: string,
): Promise<MutationResult> {
  const why = reason.trim();
  if (!why) return { error: 'Give a reason for revoking approved leave.' };

  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .update({ status: 'cancelled', rejection_reason: why })
    .eq('id', requestId)
    .eq('status', 'approved')
    .gte('end_date', today)
    .select('id');

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Only approved leave that has not yet ended can be revoked.' };
  }
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
 * Unassign the part-time / casual shifts that overlap an approved leave range
 * (full-time ones are deleted instead). Through `sm_unassign_shift` — the same
 * command as removing someone on the roster — so a Published shift goes to
 * Bidding and a Draft one simply becomes unassigned.
 *
 * Partial success is normal: a shift already reassigned or moved on by
 * someone else is refused, not fatal, so `succeeded` may be less than
 * `attempted`.
 */
export async function unassignConflictingShifts(
  shiftIds: string[],
): Promise<MutationResult<UnassignConflictsResult>> {
  if (shiftIds.length === 0) return { data: { attempted: 0, succeeded: 0 } };
  try {
    const results = await Promise.all(shiftIds.map(async (id) => {
      const { data, error } = await (supabase as any).rpc('sm_unassign_shift', { p_shift_id: id });
      if (error) throw error;
      return data?.success === true;
    }));
    return { data: { attempted: shiftIds.length, succeeded: results.filter(Boolean).length } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to unassign shifts' };
  }
}

// ── Team context ─────────────────────────────────────────────────────────────

export interface TeamMemberContext {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  isCasual: boolean;
  /** Largest contracted weekly hours across ACTIVE contracts; null when none say. */
  contractedWeeklyHours: number | null;
  /**
   * `profiles.continuous_service_start` (yyyy-MM-dd), or null when not recorded.
   * Never inferred from contract or hire dates — both are bulk-migration
   * artefacts in production (see migration 20261001140000).
   */
  serviceStart: string | null;
  balances: LeaveBalance[];
  /** Every ACTIVE contract's department / sub-department, for scope matching. */
  units: EmployeeUnit[];
}

/**
 * Who each requester is, what they have left, and where they work — the three
 * things an approval was previously made without. `leave_requests` carries only
 * an id, so the queue showed a leave type and dates and no name.
 *
 * Three reads, keyed by the requesters in view. RLS scopes each to what the
 * manager may see; a person missing from `profiles` still gets a row, named by
 * a placeholder, rather than dropping their request from the queue.
 */
export async function getTeamLeaveContext(
  employeeIds: readonly string[],
): Promise<Map<string, TeamMemberContext>> {
  const out = new Map<string, TeamMemberContext>();
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return out;

  const [profiles, balances, contracts] = await Promise.all([
    (supabase as any).from('profiles')
      .select('id, full_name, first_name, last_name, avatar_url, employment_type, continuous_service_start')
      .in('id', ids),
    (supabase as any).from('leave_balances').select('*').in('employee_id', ids),
    (supabase as any).from('user_contracts')
      .select('user_id, department_id, sub_department_id, status, employment_status, contracted_weekly_hours')
      .in('user_id', ids),
  ]);

  for (const id of ids) {
    out.set(id, {
      employeeId: id, name: 'Unknown employee', avatarUrl: null, isCasual: false,
      contractedWeeklyHours: null, serviceStart: null, balances: [], units: [],
    });
  }
  for (const p of profiles.data ?? []) {
    const m = out.get(p.id);
    if (!m) continue;
    m.name = p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ') || m.name;
    m.avatarUrl = p.avatar_url ?? null;
    m.serviceStart = p.continuous_service_start ? String(p.continuous_service_start).slice(0, 10) : null;
    const t = String(p.employment_type ?? '').toLowerCase().replace(/[-_]/g, ' ');
    m.isCasual = t === 'casual' || t === 'contractual';
  }
  for (const b of balances.data ?? []) out.get(b.employee_id)?.balances.push(mapBalanceRow(b));
  /*
   * Casual means EVERY active contract is casual. A person holding one casual
   * and one permanent contract accrues on the permanent one, and hiding their
   * annual leave because a second job is casual would be wrong. The profile's
   * employment_type stays the answer only for someone with no active contract.
   */
  const casualByContract = new Map<string, boolean>();
  for (const c of contracts.data ?? []) {
    if (c.status && String(c.status).toLowerCase() !== 'active') continue;
    const m = out.get(c.user_id);
    if (!m) continue;
    m.units.push({ departmentId: c.department_id ?? null, subDepartmentId: c.sub_department_id ?? null });
    const hours = c.contracted_weekly_hours == null ? null : Number(c.contracted_weekly_hours);
    if (hours != null && (m.contractedWeeklyHours == null || hours > m.contractedWeeklyHours)) {
      m.contractedWeeklyHours = hours;
    }
    const casual = String(c.employment_status ?? '').toLowerCase().includes('casual');
    casualByContract.set(c.user_id, (casualByContract.get(c.user_id) ?? true) && casual);
  }
  for (const [id, casual] of casualByContract) out.get(id)!.isCasual = casual;
  return out;
}

/**
 * Everyone with an ACTIVE contract inside the header scope — the rows of the
 * Leave Approvals Grid, which must list people with no leave at all.
 *
 * The narrowest level selected wins (sub-departments, else departments, else
 * organisations), read as a SET — never `[0]`. Nothing selected means nobody,
 * not everybody: the page asks for a scope rather than guessing one.
 */
export async function getScopedEmployeeIds(scope: {
  org_ids: readonly string[];
  dept_ids: readonly string[];
  subdept_ids: readonly string[];
}): Promise<string[]> {
  const [column, ids] =
    scope.subdept_ids.length > 0 ? ['sub_department_id', scope.subdept_ids]
      : scope.dept_ids.length > 0 ? ['department_id', scope.dept_ids]
        : ['organization_id', scope.org_ids];
  if (ids.length === 0) return [];

  const { data, error } = await (supabase as any)
    .from('user_contracts')
    .select('user_id')
    .eq('status', 'Active')
    .in(column, [...ids]);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean))] as string[];
}

// ── Whole-of-employment reads ────────────────────────────────────────────────

/**
 * Every request, of any status and any date, for the leave types whose
 * allowance spans the whole of employment (gender affirmation, cl 58.2; long
 * service, taken against what has accrued since service began). The ledger
 * decides which statuses count — this read does not pre-filter them.
 */
export async function getAllTimeLeaveRequests(
  employeeIds: readonly string[],
  leaveTypes: readonly LeaveTypeCode[],
): Promise<LeaveRequest[]> {
  if (employeeIds.length === 0 || leaveTypes.length === 0) return [];
  const { data, error } = await (supabase as any)
    .from('leave_requests')
    .select('*')
    .in('employee_id', [...employeeIds])
    .in('leave_type', [...leaveTypes]);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRequestRow);
}

/**
 * When this person's continuous service began — `profiles.continuous_service_start`
 * (yyyy-MM-dd) — or null when it is not recorded. The same field the team
 * context reads for managers.
 */
export async function getServiceStartDate(employeeId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('profiles')
    .select('continuous_service_start')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.continuous_service_start ? String(data.continuous_service_start).slice(0, 10) : null;
}
