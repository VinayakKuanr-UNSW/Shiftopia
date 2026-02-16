
// Template Types
// Extracted from src/api/models/types.ts

import { Employee } from '@/modules/users/model/employee.types';

/**
 * Shift definition within a template
 * Note: Uses different name from main Shift to avoid conflicts
 */
export interface TemplateShift {
    id: number;
    name: string;
    roleId?: string;
    roleName?: string;
    remunerationLevel?: string;
    startTime: string;
    endTime: string;
    netLength?: number;
    paidBreakDuration?: number;
    unpaidBreakDuration?: number;
    requiredStaff?: number;
    skills?: string[];
    licenses?: string[];
    siteTags?: string[];
    eventTags?: string[];
    notes?: string;
    // Timesheet/Roster populated fields
    status?: string;
    employeeId?: string;
    employee?: Employee;
    actualStartTime?: string;
    actualEndTime?: string;
}

/**
 * Subgroup within a template group
 */
export interface SubGroup {
    id: number;
    name: string;
    shifts: TemplateShift[];
    startTime?: string;
    endTime?: string;
}

/**
 * Group within a template
 * For ICC Sydney, groups are fixed:
 * - Convention Centre (blue)
 * - Exhibition Centre (green)
 * - Theatre (red)
 */
export interface Group {
    id: number;
    name: string;
    description?: string;
    color: string;
    icon?: string;
    subGroups: SubGroup[];
}

/**
 * Template definition
 */
export interface Template {
    id: number;
    name: string;
    description?: string;
    status: 'draft' | 'published';
    publishedMonth?: string; // Format: 'YYYY-MM' (e.g., '2024-01')
    groups: Group[];
    createdAt: string;
    updatedAt: string;
    lastEditedBy?: {
        name: string;
        avatar?: string;
    };
}

export interface ShiftTemplate {
    id: string;
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
