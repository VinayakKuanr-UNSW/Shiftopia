import * as z from 'zod';
import { ShiftTimeRange, HardValidationResult, ComplianceResult } from '@/modules/compliance';

/* ============================================================
   FORM SCHEMA
   ============================================================ */
export const formSchema = z.object({
    group_type: z.enum(['convention_centre', 'exhibition_centre', 'theatre'], { required_error: 'Group is required' }),
    sub_group_name: z.string().min(1, 'Sub-group is required'),
    role_id: z.string().min(1, 'Role is required'),
    remuneration_level_id: z.string().optional(),
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
    employeeId?: string;
    roleId?: string;
    rosterId?: string;
    eventStartTime?: string;
    eventEndTime?: string;
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
    remuneration_level_id?: string;
}

export interface RemunerationLevel {
    id: string;
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

export interface ShiftFormData {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    skills: Skill[];
    licenses: License[];
    events: Event[];
    rosters: Roster[];
    isLoading: boolean;
}

/* ============================================================
   STEP TYPES
   ============================================================ */
export interface StepProps {
    form: any;
    isReadOnly: boolean;
    isLoadingData: boolean;
    isTemplateMode: boolean;
}

export interface ScheduleStepProps extends StepProps {
    shiftLength: number;
    netLength: number;
    hardValidation: HardValidationResult;
    rosters: Roster[];
    rosterStructure: { groupType: string; subGroupName: string }[];
    selectedRosterId: string;
    onRosterChange: (id: string) => void;
    isGroupLocked?: boolean;
    isSubGroupLocked?: boolean;
    isRosterLocked?: boolean;
}

export interface RoleStepProps extends StepProps {
    roles: Role[];
    remunerationLevels: RemunerationLevel[];
    employees: Employee[];
    existingShift?: any;
    netLength: number;
    selectedRemLevel?: RemunerationLevel;
    safeContext?: ShiftContext;
    isRoleLocked?: boolean;
}

export interface RequirementsStepProps extends StepProps {
    skills: Skill[];
    licenses: License[];
    events: Event[];
}

export interface ComplianceStepProps {
    isTemplateMode: boolean;
    watchEmployeeId: string | null | undefined;
    hardValidation: HardValidationResult;
    complianceResults: Record<string, ComplianceResult | null>;
    setComplianceResults: (results: Record<string, any>) => void;
    buildComplianceInput: () => any;
    complianceNeedsRerun: boolean;
    onChecksComplete: () => void;
}

export interface ReviewLogsStepProps {
    form: any;
    editMode: boolean;
    existingShift?: any;
    safeContext: ShiftContext;
    selectedRosterId: string;
    shiftLength: number;
    netLength: number;
}
