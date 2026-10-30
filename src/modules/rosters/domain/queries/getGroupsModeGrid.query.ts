/**
 * Get Groups Mode Grid Query
 * Domain layer - builds the visual grid structure from shifts
 * 
 * This moves business logic (grouping, status derivation) out of UI
 */

import { Shift } from '@/modules/rosters/api/shifts.api';



export interface ShiftDisplay {
    id: string;
    role: string;
    startTime: string;
    endTime: string;
    employeeName?: string;
    status: 'Open' | 'Assigned' | 'Completed' | 'Draft' | 'Published';
    isPublished: boolean;
    isDraft: boolean;
    isOnBidding: boolean;
    isCancelled: boolean;
    rawShift: Shift;
}

/* ============================================================
   CONSTANTS
   ============================================================ */



