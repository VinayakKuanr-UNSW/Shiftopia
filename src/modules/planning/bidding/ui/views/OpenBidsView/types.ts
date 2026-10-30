
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

type ShiftStatus = 'all' | 'urgent' | 'pending' | 'resolved';



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
