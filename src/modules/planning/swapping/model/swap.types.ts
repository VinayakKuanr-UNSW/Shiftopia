
import { Employee, Shift } from '@/modules/core/types';


type SwapRequestStatus =
    | 'OPEN'
    | 'MANAGER_PENDING'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'EXPIRED';

interface SwapRequest {
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
            remuneration_levels?: { level_number?: number; level_name?: string } | null;
        } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
        organizations?: { name: string } | null;
    };

    requestedShift?: Shift & {
        roles?: {
            name: string;
            remuneration_levels?: { level_number?: number; level_name?: string } | null;
        } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
        organizations?: { name: string } | null;
    };

    requestorEmployee?: Employee;
    targetEmployee?: Employee; // Added to match mapToUIModel usage
    swap_offers?: {
        id: string;
        status: string;
        compliance_snapshot?: any;
        offered_shift_id?: string;
        offerer_id?: string;
        offered_shift?: {
            shiftDate: string;
            startTime: string;
            endTime: string;
            unpaidBreakMinutes?: number;
            lifecycleStatus?: string;
            stateId?: string;
            roles?: { name: string } | null;
            departments?: { name: string } | null;
        } | null;
        offerer?: { id: string; first_name: string; last_name: string; avatar_url?: string } | null;
    }[];
    managerApprovedAt?: string;
    priority?: string;
    organizationId?: string;
    departmentId?: string;
}









export type SwapStatus = SwapRequestStatus;

