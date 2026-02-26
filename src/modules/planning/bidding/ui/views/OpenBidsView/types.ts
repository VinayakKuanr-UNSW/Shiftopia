// src/modules/planning/bidding/ui/views/OpenBidsView/types.ts

export type BidToggle = 'urgent' | 'normal' | 'resolved';

export interface ManagerBidShift {
  id: string;
  role: string;
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
}

export interface TimeRemaining {
  hours: number;
  minutes: number;
  isExpired: boolean;
}

export interface ToggleCounts {
  urgent: number;
  normal: number;
  resolved: number;
}
