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
}

export type BidToggle = 'urgent' | 'normal' | 'resolved';

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
  urgent: number;
  normal: number;
  resolved: number;
}
