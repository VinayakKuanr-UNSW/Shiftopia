
// Employee & User Types
// Extracted from src/api/models/types.ts

export type AccessLevel = 'Alpha' | 'Beta' | 'Gamma' | 'Delta';
export type ContractStatus = 'Active' | 'Inactive' | 'Terminated';

export interface UserContract {
    id: string;
    userId: string;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    roleId: string;
    remLevelId: string;
    accessLevel: AccessLevel;
    status: ContractStatus;
    notes?: string;
    startDate: string;
    endDate?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Employee {
    id: string;
    userId?: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone?: string;
    avatarUrl?: string;
    role?: string;
    systemRole?: string;
    organizationId?: string;
    is_active: boolean;
    contracts?: UserContract[];
    createdAt: string;
    updatedAt: string;
}
