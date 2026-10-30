
// Roster & Shift Types
// Extracted from src/api/models/types.ts

import type { TemplateGroupType } from '@/modules/rosters/domain/shift.entity';

type LifecycleStatus =
    | 'draft'
    | 'scheduled'
    | 'active'
    | 'completed'
    | 'cancelled';

type ShiftFlagType =
    | 'on_bidding'
    | 'trade_requested'
    | 'high_priority'
    | 'compliance_issue';





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
    scheduledLength: number;
    complianceOverride: boolean;
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
    /**
     * The DENORMALISED group. `roster_subgroup_id` is the structural link and is
     * NOT NULL, but the Roster Planner buckets its cells on this text column
     * (`GroupModeView` filters `cell.group_type === group.type`), so a shift
     * with a correct subgroup and a null `group_type` is parented properly and
     * renders nowhere.
     *
     * Typed as `TemplateGroupType` — the roster's five fixed groups. This field
     * once listed three ('the_cutaway' was missing), so a fixed group could not
     * be named through the typed create path at all.
     */
    group_type?: TemplateGroupType;
    last_dropped_by?: string;
    last_rejected_by?: string;
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


