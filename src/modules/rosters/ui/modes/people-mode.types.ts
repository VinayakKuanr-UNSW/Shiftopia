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
    shifts: Record<string, PeopleModeShift[]>;
}
