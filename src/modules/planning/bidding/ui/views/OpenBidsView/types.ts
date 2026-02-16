// src/modules/planning/ui/views/OpenBidsView/types.ts

export type ShiftStatus = 'urgent' | 'pending' | 'resolved';
export type GroupType = 'convention' | 'exhibition' | 'concert' | 'sports' | 'corporate';
export type FatigueRisk = 'low' | 'medium' | 'high';

export interface OpenShift {
  id: string;
  title: string;
  group: GroupType;
  groupLabel: string;
  date: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  netHours: number | string;
  paidBreak: number;
  unpaidBreak: number;
  location: string;
  department: string;
  subDepartment: string;
  role: string;
  remunerationLevel?: string;
  hourlyRate?: string;
  status: ShiftStatus;
  bidCount: number;
  biddingDeadline: string;
  shiftIdDisplay: string;
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  // Extended fields for ShiftCardCompact
  lifecycleStatus: 'draft' | 'published' | 'completed' | 'cancelled';
  assignmentStatus: 'assigned' | 'unassigned';
  fulfillmentStatus?: 'scheduled' | 'bidding' | 'offered' | 'none';
  assignmentOutcome?: 'pending' | 'offered' | 'confirmed' | 'emergency_assigned';
  groupColor?: string;
  subGroup?: string;
  employeeName?: string;
  isUrgent?: boolean;
  stateId?: string;
}

export interface EmployeeBid {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employmentType: string;
  pool: string;
  department: string;
  status: string;
  submittedAt: string;
  fatigueRisk: FatigueRisk;
  fatigueLabel: string;
  fatigueReason: string;
  isBestMatch: boolean;
}

export interface TimeRemaining {
  hours: number;
  minutes: number;
  isExpired: boolean;
}

export interface FilterState {
  orgId: string;
  deptId: string;
  subDeptId: string;
  status: ShiftStatus | 'all';
}

export interface Organization {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
  organization_id: string;
}

export interface SubDepartment {
  id: string;
  name: string;
  department_id: string;
}

export interface StatusCounts {
  urgent: number;
  pending: number;
  resolved: number;
}
