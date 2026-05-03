import type { Shift } from '@/modules/rosters/domain/shift.entity';

export interface PeopleModeShift {
    id: string;
    role: string;
    remunerationLevel: string;
    startTime: string;
    endTime: string;
    department: string;
    subGroup: string;
    group: string;
    groupColor: 'blue' | 'green' | 'red' | 'orange' | 'purple' | string;
    hours: number;
    pay: number;
    status: 'Open' | 'Assigned' | 'Completed' | 'Draft';
    lifecycleStatus: 'draft' | 'published';
    assignmentStatus: 'assigned' | 'unassigned';
    fulfillmentStatus: 'scheduled' | 'bidding' | 'offered' | 'none';
    isTradeRequested: boolean;
    isCancelled: boolean;
    eventTags?: Array<{ name: string; color: string }>;
    requiredSkills?: string[];
    /** Raw shift entity for SmartShiftCard rendering */
    rawShift?: Shift;
}

export interface PeopleModeEmployee {
    id: string;
    name: string;
    employeeId: string;
    avatar: string;
    contractedHours: number;
    currentHours: number;
    /** True when scheduledHours > contractedHours */
    overHoursWarning?: boolean;
    estimatedPay: number;
    fatigueScore: number;
    utilization: number;
    payBreakdown: {
      base: number;
      penalty: number;
      overtime: number;
      allowance: number;
      leave: number;
    };
    shifts: Record<string, PeopleModeShift[]>;
}

// ── DnD type constants for People Mode ───────────────────────────────────────
/** Drag type for unfilled shift cards dragged from the side panel */
export const DND_UNFILLED_SHIFT = 'UNFILLED_SHIFT' as const;

/** Drag type for employee cards dragged from the side panel (Group Mode) */
export const DND_EMPLOYEE_TYPE = 'EMPLOYEE_CARD' as const;

/** Drag type for existing shift cards (shared between modes) */
export const DND_SHIFT_TYPE = 'SHIFT_CARD' as const;

export interface EmployeeDragItem {
  employeeId: string;
  employeeName: string;
  /** Role name from the employee's contract — used for lightweight UI-level role match hint */
  roleName: string | null;
}

export interface ShiftDragItem {
  shiftId: string;
  sourceGroupType: string | 'unassigned'; // Can be TemplateGroupType or 'people-mode'
  sourceSubGroup: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  lifecycle_status: 'Draft' | 'Published';
  is_cancelled: boolean;
}

// ============================================================================
// DRAG & DROP TYPE
// ============================================================================

type DragItem = ShiftDragItem;
