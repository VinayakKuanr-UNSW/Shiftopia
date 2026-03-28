
// Roster & Shift Types
// Extracted from src/api/models/types.ts

import type { ShiftWorkflowStatus } from '@/modules/planning/unified/types';

export type LifecycleStatus =
    | 'draft'
    | 'scheduled'
    | 'active'
    | 'completed'
    | 'cancelled';

export type ShiftFlagType =
    | 'on_bidding'
    | 'trade_requested'
    | 'high_priority'
    | 'compliance_issue';

export interface LifecycleConfig {
    status: LifecycleStatus;
    label: string;
    color: string;
    bgColor: string;
    textColor: string;
    description: string;
}

export interface ShiftFlag {
    id: string;
    shiftId: string;
    flagType: ShiftFlagType;
    enabled: boolean;
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface ShiftFlagConfig {
    type: ShiftFlagType;
    icon: string;
    label: string;
    tooltip: string;
    color: string;
    priority: number;
}

export interface LifecycleLogEntry {
    id: string;
    shiftId: string;
    oldStatus: LifecycleStatus | null;
    newStatus: LifecycleStatus;
    changedAt: string;
    changedBy?: string;
    reason?: string;
}

export interface Shift {
    id: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    roleId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    paidBreakDuration: number;
    unpaidBreakDuration: number;
    length: number;
    netLength: number;
    remunerationLevelId: string;
    assigned_employee_id?: string;
    lifecycleStatus: LifecycleStatus;
    stateId?: string;
    shiftGroupId?: string;
    shiftSubgroupId?: string;
    isDraft: boolean;
    biddingEnabled: boolean;
    biddingOpenAt?: string;
    biddingCloseAt?: string;
    cancelledAt?: string;
    cancelledBy?: string;
    cancellationReason?: string;
    createdAt: string;
    updatedAt: string;
    role?: string;
    employeeName?: string;
    remunerationLevel?: string;
    flags?: ShiftFlagType[];
    breakDuration?: number;
    notes?: string;
    templateBatchId?: string;
    group_type?: 'convention_centre' | 'exhibition_centre' | 'theatre';
    workflow_status?: ShiftWorkflowStatus;
}

export interface Roster {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    createdBy: string;
    publishedAt?: string;
    isLocked?: boolean;
    createdAt: string;
    updatedAt: string;
}

/* ============================================================
   LIFECYCLE CONFIGS
   ============================================================ */

export const LIFECYCLE_CONFIGS: Record<LifecycleStatus, LifecycleConfig> = {
    draft: {
        status: 'draft',
        label: 'Draft',
        color: 'yellow',
        bgColor: 'bg-yellow-500/20',
        textColor: 'text-yellow-700 dark:text-yellow-300',
        description: 'Shift created but not published',
    },
    scheduled: {
        status: 'scheduled',
        label: 'Scheduled',
        color: 'blue',
        bgColor: 'bg-blue-500/20',
        textColor: 'text-blue-700 dark:text-blue-300',
        description: 'Shift scheduled and published',
    },
    active: {
        status: 'active',
        label: 'Active',
        color: 'green',
        bgColor: 'bg-green-500/20',
        textColor: 'text-green-700 dark:text-green-300',
        description: 'Shift currently in progress',
    },
    completed: {
        status: 'completed',
        label: 'Completed',
        color: 'gray',
        bgColor: 'bg-gray-500/20',
        textColor: 'text-gray-700 dark:text-gray-400',
        description: 'Shift has been completed',
    },
    cancelled: {
        status: 'cancelled',
        label: 'Cancelled',
        color: 'red',
        bgColor: 'bg-red-500/20',
        textColor: 'text-red-700 dark:text-red-300',
        description: 'Shift has been cancelled',
    },
};

export const SHIFT_FLAG_CONFIGS: Record<ShiftFlagType, ShiftFlagConfig> = {
    on_bidding: {
        type: 'on_bidding',
        icon: 'Gavel',
        label: 'On Bidding',
        tooltip: 'This shift is open for employee bidding',
        color: 'text-purple-600 dark:text-purple-400',
        priority: 1,
    },
    trade_requested: {
        type: 'trade_requested',
        icon: 'ArrowLeftRight',
        label: 'Trade Requested',
        tooltip: 'An employee has requested to trade this shift',
        color: 'text-purple-600 dark:text-purple-400',
        priority: 2,
    },
    high_priority: {
        type: 'high_priority',
        icon: 'Zap',
        label: 'High Priority',
        tooltip: 'This shift is marked as high priority',
        color: 'text-orange-600 dark:text-orange-400',
        priority: 3,
    },
    compliance_issue: {
        type: 'compliance_issue',
        icon: 'AlertTriangle',
        label: 'Compliance Issue',
        tooltip: 'This shift has compliance or qualification issues',
        color: 'text-red-600 dark:text-red-400',
        priority: 4,
    },
};
