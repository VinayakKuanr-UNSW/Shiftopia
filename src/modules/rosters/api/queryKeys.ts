import { TemplateGroupType, ShiftStatus } from '../domain/shift.entity';

// ============================================================================
// TYPES
// ============================================================================

export interface ShiftFilters {
    departmentId?: string;
    subDepartmentId?: string;
    departmentIds?: string[];
    subDepartmentIds?: string[];
    groupType?: TemplateGroupType;
    status?: ShiftStatus;
    roleId?: string;
    skillIds?: string[];
    complianceStatus?: 'compliant' | 'warning' | 'violation';
}

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const shiftKeys = {
    all: ['shifts'] as const,
    byDate: (orgId: string, date: string, filters?: ShiftFilters) =>
        ['shifts', 'byDate', orgId, date, filters] as const,
    byEmployee: (employeeId: string, startDate: string, endDate: string) =>
        ['shifts', 'byEmployee', employeeId, startDate, endDate] as const,
    detail: (shiftId: string) => ['shifts', 'detail', shiftId] as const,
    offers: (employeeId: string) => ['shifts', 'offers', employeeId] as const,
    offerCount: (employeeId: string) => ['shifts', 'offerCount', employeeId] as const,
    byDateRange: (orgId: string, startDate: string, endDate: string, filters?: ShiftFilters) =>
        ['shifts', 'byDateRange', orgId, startDate, endDate, filters] as const,
    auditLog: (shiftId: string) => ['shifts', 'auditLog', shiftId] as const,
    lookups: {
        organizations: () => ['shifts', 'lookups', 'organizations'] as const,
        departments: (orgId?: string) => ['shifts', 'lookups', 'departments', orgId] as const,
        subDepartments: (deptId?: string) => ['shifts', 'lookups', 'subDepartments', deptId] as const,
        roles: (deptId?: string, subDeptId?: string) =>
            ['shifts', 'lookups', 'roles', deptId, subDeptId] as const,
        employees: (orgId?: string) => ['shifts', 'lookups', 'employees', orgId] as const,
        templates: (subDeptId?: string, deptId?: string) =>
            ['shifts', 'lookups', 'templates', subDeptId, deptId] as const,
        remunerationLevels: () => ['shifts', 'lookups', 'remunerationLevels'] as const,
        skills: () => ['shifts', 'lookups', 'skills'] as const,
        licenses: () => ['shifts', 'lookups', 'licenses'] as const,
        events: (orgId?: string) => ['shifts', 'lookups', 'events', orgId] as const,
    },
    openShifts: (orgId?: string) => ['shifts', 'open', orgId] as const,
    bids: (shiftId: string) => ['shifts', 'bids', shiftId] as const,
};
