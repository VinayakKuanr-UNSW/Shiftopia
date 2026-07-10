/**
 * Leave module — public surface.
 *
 * Leave management: policy definitions (NES/EBA accrual rates), balance
 * projection, request CRUD, and approve/reject workflows. The DB migration
 * adds `leave_balances` and enhances `leave_requests`.
 */
export type {
  LeaveTypeCode,
  LeavePolicy,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestStatus,
  CreateLeaveRequestInput,
} from './model/leave.types';

export { LEAVE_TYPE_LABELS } from './model/leave.types';

export {
  LEAVE_POLICIES,
  projectBalance,
  isCertificateRequired,
  BALANCE_TRACKED_TYPES,
} from './domain/leave-policy';

export {
  getLeaveBalances,
  getLeaveRequests,
  getTeamLeaveRequests,
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  getLeaveShiftConflicts,
  type LeaveShiftConflict,
  type LeaveRequestFilters,
  type MutationResult,
} from './api/leave.api';

export { formatLeaveConflictWarning } from './domain/leave-conflicts';
