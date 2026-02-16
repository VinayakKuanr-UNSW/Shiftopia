
// Organization & Core Domain Types
// Extracted from src/api/models/types.ts

export interface Department {
    id: string;
    organizationId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface SubDepartment {
    id: string;
    departmentId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface Role {
    id: string;
    name: string;
    departmentId?: string;
    subDepartmentId?: string;
    remunerationLevelId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface RemunerationLevel {
    id: string;
    level: number;
    description?: string;
    hourlyRate: number;
    createdAt: string;
    updatedAt: string;
}

export interface Organization {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}
