// Mock data for Roles Mode View
// TODO: Replace with real API calls

export interface RemunerationLevel {
  id: string;
  name: string;
  color: string;
  hourlyRate: number;
  level: string; // Used by getLevelColor
  description: string; // Used in UI
  roles: { id: string; name: string }[]; // Used in UI
}

export interface RoleShift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName?: string;
  status: string;
}

export interface RoleDayData {
  date: string;
  shifts: RoleShift[];
}

export const mockOrganizations = [
  { id: 'org-1', name: 'Organization 1' },
  { id: 'org-2', name: 'Organization 2' },
];

export const mockDepartments = [
  { id: 'dept-1', name: 'Department 1', organizationId: 'org-1' },
  { id: 'dept-2', name: 'Department 2', organizationId: 'org-1' },
];

export const mockSubDepartments = [
  { id: 'subdept-1', name: 'Sub-Department 1', departmentId: 'dept-1' },
  { id: 'subdept-2', name: 'Sub-Department 2', departmentId: 'dept-1' },
];

export const mockRemunerationLevels: RemunerationLevel[] = [
  {
    id: 'level-1',
    name: 'Level 1',
    color: 'blue',
    hourlyRate: 35.50,
    level: 'L1',
    description: 'Level 1 Base',
    roles: [{ id: 'r1', name: 'Usher' }]
  },
  {
    id: 'level-2',
    name: 'Level 2',
    color: 'green',
    hourlyRate: 42.00,
    level: 'L2',
    description: 'Level 2 Specialized',
    roles: [{ id: 'r2', name: 'Supervisor' }]
  },
  {
    id: 'level-3',
    name: 'Level 3',
    color: 'purple',
    hourlyRate: 55.00,
    level: 'L3',
    description: 'Level 3 Management',
    roles: [{ id: 'r3', name: 'Manager' }]
  },
];

export function generateRolesModeData(date: Date, viewType: string): RoleDayData[] {
  // TODO: Implement actual data generation
  return [];
}

export function getDepartmentsByOrg(orgId: string) {
  return mockDepartments.filter(dept => dept.organizationId === orgId);
}

export function getSubDepartmentsByDept(deptId: string) {
  return mockSubDepartments.filter(subdept => subdept.departmentId === deptId);
}

export function getLevelColor(levelId: string): string {
  const level = mockRemunerationLevels.find(l => l.id === levelId);
  return level?.color || 'gray';
}
