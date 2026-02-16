
import { Employee, Shift } from '@/types';

// ==========================================
// DB / DOMAIN TYPES
// ==========================================

export type TradeRequestStatus =
    | 'pending'
    | 'target_accepted'
    | 'manager_approved'
    | 'rejected'
    | 'cancelled';

export type SwapRequestStatus =
    | 'OPEN'
    | 'MANAGER_PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'COMPLETED';

export interface SwapRequest {
    id: string;
    original_shift_id: string;
    requested_by_employee_id: string; // The employee initializing the swap
    swap_with_employee_id: string | null; // NULL for open marketplace, set for specific trade
    offered_shift_id: string | null; // NULL if just dropping, set if trading a specific shift
    status: SwapRequestStatus;
    reason: string | null;
    created_at: string;
    updated_at: string;
    manager_approval_required?: boolean;
}

export interface SwapRequestWithDetails extends SwapRequest {
    // Relations specifically named in ManagerSwaps usage map
    originalShift?: Shift & {
        roles?: {
            name: string;
            remuneration_levels?: { hourly_rate_min: number } | null;
        } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
    };
    requestedShift?: Shift & {
        roles?: {
            name: string;
            remuneration_levels?: { hourly_rate_min: number } | null;
        } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
    };
    requestorEmployee?: Employee;
    targetEmployee?: Employee; // Added to match mapToUIModel usage
    swap_offers?: {
        id: string;
        status: string;
        compliance_snapshot?: any;
        offered_shift_id?: string;
    }[];
    managerApprovedAt?: string;
    priority?: string;
    organizationId?: string;
    departmentId?: string;
}

export type SwapType = 'give_away' | 'trade'; // Inferred

export type SwapPriority = 'high' | 'medium' | 'low';
export type SwapOfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface SwapOffer {
    id: string;
    swap_request_id: string;
    offered_shift_id: string;
    offered_by_employee_id: string;
    status: SwapOfferStatus;
    created_at: string;
}

export interface SwapOfferWithDetails extends SwapOffer {
    offered_shift: Shift;
    offered_by: Employee;
}

export interface TradeRequest extends SwapRequest {
    // Alias or extended type
}


// ==========================================
// UI / VIEW TYPES (ManagerSwaps.page.tsx)
// ==========================================

export type GroupType = 'convention' | 'exhibition' | 'theatre';

export interface EmployeeShiftDetails {
    employeeId: string;
    employeeName: string;
    avatar?: string;
    group: GroupType;
    groupLabel: string;
    subGroup: string;
    role: string;
    ampmBase: string; // e.g. 'Main Floor'
    leader: string;
    bumpInOut: string;
    shiftDate: string;
    shiftStart: string;
    shiftEnd: string;
    totalHours: number;
}

export type SwapStatus = SwapRequestStatus;

export interface SwapRequestManagement {
    id: string;
    requestor: EmployeeShiftDetails;
    recipient: EmployeeShiftDetails;
    status: SwapStatus;
    priority: string; // 'high' | 'medium' | 'low'
    reason: string;
    hoursDifference: number;
    submittedAt: string;
    processedBy: string;
    processedAt?: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
}
