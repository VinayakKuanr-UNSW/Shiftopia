// src/modules/planning/bidding/ui/views/OpenBidsView/types.ts

export type GroupType = 'convention' | 'exhibition' | 'concert' | 'sports' | 'corporate';

export interface OpenShift extends ManagerBidShift {
  location: string;
  shiftIdDisplay: string;
  unpaidBreak: number;
  paidBreak: number;
  assignmentStatus: 'assigned' | 'unassigned';
  group: string;
  groupLabel: string;
  department: string;
  remunerationLevel?: string;
  dayLabel: string;
  netHours: string;
  stateId: string;
  biddingDeadline: string;
  status: ShiftStatus;
}

export type ShiftStatus = 'all' | 'urgent' | 'pending' | 'resolved';

export interface FilterState {
  status: ShiftStatus;
}

export interface StatusCounts {
  all: number;
  urgent: number;
  pending: number;
  resolved: number;
}

export interface ManagerBidShift {
  id: string;
  role: string;
  roleId?: string;
  date: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  netHours: string;
  paidBreak: number;
  unpaidBreak: number;
  department: string;
  subDepartment: string;
  organization: string;
  remunerationLevel?: string;
  bidCount: number;
  biddingDeadline: string;
  stateId: string;
  toggle: BidToggle;
  isUrgent: boolean;
  assignedEmployeeName?: string;
  assignedEmployeeId?: string;
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  groupType?: string | null;
  lifecycleStatus?: string;
}

// Real SSS breakdown (sourced from get_quarterly_performance_report + skill match).
// See utils/sss.ts for the composition + weights.
export type { SssBreakdown as SSSBreakdown, SssFlag } from '../../utils/sss';

/** Per-shift qualification/eligibility of a bidder. */
export type BidEligibility = 'pass' | 'warning' | 'blocked';

export interface EmployeeBid {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employmentType: string;
  status: string;
  submittedAt: string;
  isWinner: boolean;
  fatigueRisk?: 'low' | 'medium' | 'high';
  isBestMatch?: boolean;
  sss: number;
  sssBreakdown?: import('../../utils/sss').SssBreakdown;
  /** data-quality flag: OK | LIMITED | INSUFFICIENT_DATA (new/low-history bidder) */
  sssFlag?: import('../../utils/sss').SssFlag;
  /** per-shift skill/qualification eligibility (batched qual check) */
  eligibility?: BidEligibility;
}

export type BidSortField = 'timestamp' | 'sss';
export type BidSortDirection = 'asc' | 'desc';

export interface BidSortOption {
  field: BidSortField;
  direction: BidSortDirection;
}




export type BidToggle = 'standard' | 'urgent' | 'resolved' | 'expired';

export interface TimeRemaining {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

export interface ToggleCounts {
  standard: number;
  urgent: number;
  resolved: number;
  expired: number;
}
