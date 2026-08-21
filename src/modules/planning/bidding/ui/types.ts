import type { ParticipationStatus } from '../model/bid.types';

export interface ShiftData {
    id: any;
    role: string;
    organization: string;
    department: string;
    subDepartment: string;
    /**
     * The sub-department UUID — needed to scope the availability self-check
     * to THIS job rather than the person-wide answer, which for a 1 FT + 4
     * Casual employee always resolves to Full-Time and suppresses the warning.
     */
    subDepartmentId?: string | null;
    group: string;
    subGroupName: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    startAt?: string | null;
    endAt?: string | null;
    tzIdentifier?: string | null;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    assignedTo: string | null;
    isEligible: boolean;
    ineligibilityReason?: string;
    groupType?: string | null;
    priority?: string | null;
    biddingWindowOpens?: string | null;
    biddingWindowCloses?: string | null;
    isUrgent?: boolean;
    stateId?: string;
    lifecycleStatus?: string;
    subGroupColor?: string;
    last_dropped_by?: string | null;
    last_rejected_by?: string | null;
    droppedById?: string | null;
}

export interface BidData {
    id: any;
    shiftId: any;
    role: string;
    organization: string;
    department: string;
    subDepartment: string;
    group: string;
    subGroupName: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    startAt?: string | null;
    endAt?: string | null;
    tzIdentifier?: string | null;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'selected';
    bidTime: string;
    notes: string | null;
    groupType?: string | null;
    stateId?: string;
    lifecycleStatus?: string;
    subGroupColor?: string;
}

export interface ShiftOpportunity extends ShiftData {
    participationStatus: ParticipationStatus;
    currentBid: BidData | null;
}
