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
    /**
     * Which weekday a TEMPLATE shift repeats on. 0 = Sunday … 6 = Saturday,
     * matching `template_shifts.day_of_week` and JavaScript's `getDay()`.
     *
     * `null` is the "every day" wildcard, and it is a REAL state rather than an
     * absence: `apply_template_to_date_range_v2` stamps a null-day shift onto
     * every date in the range, holidays included. That is occasionally what an
     * author wants and was, until now, what they always got — the field existed
     * on the row and in the save RPC, but no control ever set it, so all 26
     * template shifts in production were null by default rather than by choice.
     *
     * Ignored outside template mode, where a shift has a concrete date instead.
     */
    day_of_week: z.number().int().min(0).max(6).optional().nullable(),
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
    /**
     * What to record in `shifts.creation_source`, when the caller is not a
     * manager typing a one-off shift.
     *
     * Defaults to 'manual' ('template' in template mode), which is what the
     * Roster Planner wants. A provenance label only: until 2026-10-04 a trigger
     * (`enforce_ft_shifts_are_baseline_only`) refused any FT shift not labelled
     * 'baseline_ft', which is why the Office page still passes that value.
     * Migration 20261004170000 dropped it — FT shifts are created on the
     * Rosters page with the default.
     */
    creationSource?: string;
    /**
     * Pre-fills Employment target on a NEW shift (edit reads the row's own,
     * falling back to this). A surface that locks the field must also fill
     * it: a lock over an empty value leaves the Role step invalid for good.
     */
    targetEmploymentType?: FormValues['target_employment_type'];
}

export interface EnhancedAddShiftModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    context?: ShiftContext | null;
    isTemplateMode?: boolean;
    editMode?: boolean;
    existingShift?: any;
    /**
     * Fields the caller has already decided, rendered but not editable.
     *
     * For a surface where the grid position IS the answer — the Office week grid
     * fixes employee, date and target type by which cell was clicked, and role,
     * group and sub-group by contract and convention — a picker would only offer
     * ways to make the row wrong. Empty by default, so the Roster Planner is
     * unaffected.
     *
     * Distinct from the existing global read-only state, which is about a
     * PUBLISHED shift and disables everything at once.
     */
    lockedFields?: readonly (keyof FormValues)[];
    onShiftCreated?: (shiftData: any) => void;
}

/* ============================================================
   DATA TYPES
   ============================================================ */
export interface Role {
    id: string;
    name: string;
    /** Optional default level for new shifts — not the pay level (that is the contract's). */
    remuneration_level?: number | null;
    /** The role's EA band; both null = no EA guidance. */
    eba_level_min?: number | null;
    eba_level_max?: number | null;
}

export interface RemunerationLevel {
    level_number: number;
    level_name: string;
    hourly_rate_min?: number;
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
    /** Locks the Employment target select. See `lockedFields`. */
    isTargetTypeLocked?: boolean;
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
    /** Locks the Employment target select. See `lockedFields`. */
    isTargetTypeLocked?: boolean;

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
