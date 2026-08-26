import type * as React from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { ShiftTimeRange, HardValidationResult, ComplianceResult } from '@/modules/compliance';
import type { UseCompliancePanelReturn } from '@/modules/compliance/ui/useCompliancePanel';
import type { ShapeResult, ShapeHit } from '@/modules/compliance/shape';

/* ============================================================
   FORM SCHEMA
   ============================================================ */
export const formSchema = z.object({
    group_type: z.string().min(1, 'Group is required'),
    sub_group_name: z.string().min(1, 'Sub-group is required'),
    role_id: z.string().min(1, 'Role is required'),
    remuneration_level: z.number().optional().nullable(),
    shift_date: z.date().optional(),
    start_time: z.string().min(1, 'Start time is required'),
    end_time: z.string().min(1, 'End time is required'),
    paid_break_minutes: z.number().min(0).optional(),
    unpaid_break_minutes: z.number().min(0).optional(),
    timezone: z.string().default('Australia/Sydney'),
    assigned_employee_id: z.string().optional().nullable(),
    required_skills: z.array(z.string()).optional(),
    required_licenses: z.array(z.string()).optional(),
    event_ids: z.array(z.string()).optional(),
    notes: z.string().optional(),
    is_training: z.boolean().optional(),
    // Who this shift is for. MANDATORY — there is no "Any": the DB column is NOT
    // NULL and the match is enforced hard at assignment time.
    target_employment_type: z.enum(['FT', 'PT', 'Casual'], {
        required_error: 'Target employment type is required',
        invalid_type_error: 'Target employment type is required',
    }),
    // Only meaningful with a 'PT' target — mirrors
    // shifts_target_flexible_requires_pt_check.
    target_requires_flexible: z.boolean().optional(),
});

export type FormValues = z.infer<typeof formSchema>;

/* ============================================================
   CONTEXT INTERFACE
   ============================================================ */
export interface ShiftContext {
    mode?: 'group' | 'people' | 'events' | 'roles' | 'template';
    launchSource?: 'grid' | 'global' | 'edit';
    date?: string;
    organizationId?: string;
    organizationName?: string;
    departmentId?: string;
    departmentName?: string;
    subDepartmentId?: string;
    subDepartmentName?: string;
    departmentIds?: string[];
    subDepartmentIds?: string[];
    groupId?: string;
    groupName?: string;
    subGroupId?: string;
    subGroupName?: string;
    groupColor?: string;
    group_type?: string;
    sub_group_name?: string;
    employeeId?: string;
    roleId?: string;
    remunerationLevel?: number;
    rosterId?: string;
    eventStartTime?: string;
    eventEndTime?: string;
    eventId?: string;
}

export interface EnhancedAddShiftModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    context?: ShiftContext | null;
    isTemplateMode?: boolean;
    editMode?: boolean;
    existingShift?: any;
    onShiftCreated?: (shiftData: any) => void;
}

/* ============================================================
   DATA TYPES
   ============================================================ */
export interface Role {
    id: string;
    name: string;
    remuneration_level?: number;
}

export interface RemunerationLevel {
    level_number: number;
    level_name: string;
    hourly_rate_min: number;
    hourly_rate_max?: number;
}

export interface Employee {
    id: string;
    first_name: string;
    last_name: string;
    full_name?: string;
    profiles?: { full_name?: string };
    /** Already fetched by getEmployees()/EligibilityService — just wasn't typed through here. */
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
}

export interface Skill {
    id: string;
    name: string;
}

export interface License {
    id: string;
    name: string;
}

export interface Event {
    id: string;
    name: string;
}

export interface Roster {
    id: string;
    name: string;
    description?: string;
    start_date: string;
    end_date: string;
    department_id?: string;
    status?: string;
    sub_department_id?: string;
    groups?: {
        id: string;
        name: string;
        external_id?: string;
        subGroups: {
            id: string;
            name: string;
        }[]
    }[];
}

/* ============================================================
   RENDER LAYERS
   The per-step prop interfaces (ScheduleStepProps, RoleStepProps,
   RequirementsStepProps, ComplianceStepProps, AssignmentStepProps, BreakStepProps
   and the shared StepProps) were deleted with the components they described.
   Two render layers remain: the desktop drawer and the mobile sheet.
   ============================================================ */
export interface ShiftFormDrawerContentProps {
    form: ReturnType<typeof useForm<FormValues>>;
    isReadOnly: boolean;
    isPast?: boolean;
    isStarted?: boolean;
    isPublished?: boolean;
    isTemplateMode: boolean;
    editMode: boolean;
    existingShift?: any;

    // Data
    roles: any[];
    remunerationLevels: any[];
    employees: any[];
    skills: any[];
    licenses: License[];
    events: Event[];
    rosters: any[];
    rosterStructure: any;
    activeSubGroups: any[];
    isLoadingData: boolean;
    isLoadingShifts: boolean;
    isGroupLocked: boolean;
    isSubGroupLocked: boolean;

    // Derived / Computed
    resolvedContext: any;
    selectedRosterId: string;
    setSelectedRosterId: (id: string) => void;
    shiftLength: number;
    netLength: number;
    hardValidation: any;
    isAssignmentEnabled: boolean;
    minShiftHours: number;
    /** Employee-free EBA shape verdict for the current form values. */
    shape: ShapeResult;
    /** `shape.hits` filtered to the blocking ones, in field order. */
    shapeBlockers: ShapeHit[];

    // Compliance
    compliancePanel: any;
    runV2Compliance: () => void;

    // Handlers
    onUnpublish?: () => void;
    canUnpublish?: boolean;

    selectedRemLevel?: RemunerationLevel;
    isRoleLocked?: boolean;
    isEmployeeLocked?: boolean;
    isScheduleDefined: boolean;

    /** Active wizard step (1..5) */
    currentStep?: number;
    /** Jump to a step (used by the top tabs / stepper) */
    onStepChange?: (step: number) => void;
    /** Which steps the user has completed (for the stepper checkmarks) */
    completedSteps?: Set<number>;

    // Form actions & submission status
    onCancel?: () => void;
    onSubmit?: (values: any) => void;
    canSave?: boolean;
    isLoading?: boolean;
    saveBlockReason?: string | null;
}

/**
 * Props for the MOBILE bottom-sheet render layer (ShiftFormSheet).
 *
 * Deliberately not `ShiftFormDrawerContentProps`: the sheet has no wizard, so
 * the step props (currentStep / onStepChange / completedSteps) are meaningless,
 * and it owns the primary action itself instead of leaving it to a modal
 * chrome above — hence canSave / isLoading / onSubmit / onCancel.
 */
export interface ShiftFormSheetProps {
    form: ReturnType<typeof useForm<FormValues>>;
    isReadOnly: boolean;
    isPast?: boolean;
    isStarted?: boolean;
    isPublished?: boolean;
    isTemplateMode: boolean;
    editMode: boolean;
    existingShift?: any;

    // Data
    roles: any[];
    employees: any[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    rosters: any[];
    isLoadingData: boolean;
    isLoadingShifts: boolean;

    // Derived / computed
    resolvedContext: any;
    selectedRosterId: string;
    shiftLength: number;
    netLength: number;
    hardValidation: any;
    minShiftHours: number;
    /** Employee-free EBA shape verdict for the current form values. */
    shape: ShapeResult;
    /** `shape.hits` filtered to the blocking ones, in field order. */
    shapeBlockers: ShapeHit[];

    // Compliance
    compliancePanel: UseCompliancePanelReturn;

    // Locks
    isGroupLocked: boolean;
    isSubGroupLocked: boolean;
    isRoleLocked?: boolean;
    isEmployeeLocked?: boolean;

    // Actions
    canUnpublish?: boolean;
    onUnpublish?: () => void;
    canSave: boolean;
    /** Why `canSave` is false, phrased as the next action. `null` when saveable. */
    saveBlockReason: string | null;
    isLoading: boolean;
    onSubmit: (values: FormValues) => void | Promise<void>;
    onCancel: () => void;
    containerRef?: React.Ref<HTMLDivElement>;
}
