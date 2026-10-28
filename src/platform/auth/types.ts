export type AccessLevel = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta';
type CertificateType = 'X' | 'Y';
export type Role = 'admin' | 'manager' | 'teamlead' | 'member';

export interface UserContract {
    id: string;
    userId: string;
    organizationId: string;
    departmentId: string | null;
    subDepartmentId: string | null;
    roleId: string;
    remLevelId: number;
    accessLevel: AccessLevel; // DEPRECATED - Use certificates
    employmentStatus?: string | null;
    status: string;
    organizationName?: string;
    departmentName?: string;
    subDepartmentName?: string;
    roleName?: string;
}

export interface AccessCertificate {
    id: string;
    userId: string;
    certificateType: CertificateType;
    accessLevel: AccessLevel;
    organizationId: string | null;
    departmentId: string | null;
    subDepartmentId: string | null;
    isActive: boolean;
    // Resolved names for display
    organizationName?: string;
    departmentName?: string | null;
    subDepartmentName?: string | null;
}

// =============================================
// Scope Tree types (from resolve_user_permissions RPC)
// =============================================

interface ScopeSubDept {
    id: string;
    name: string;
}

export interface ScopeDept {
    id: string;
    name: string;
    subdepartments: ScopeSubDept[];
}

export interface ScopeOrg {
    id: string;
    name: string;
    departments: ScopeDept[];
}

export interface ScopeTree {
    organizations: ScopeOrg[];
}

interface PermissionCert {
    id: string;
    level: AccessLevel;
    org_id: string;
    dept_id: string | null;
    subdept_id: string | null;
    org_name: string;
    dept_name: string | null;
    subdept_name: string | null;
}

export interface PermissionObject {
    typeX: PermissionCert[];
    /** The highest managerial (Type Y) certificate, when there are several. */
    typeY: PermissionCert | null;
    /**
     * Every managerial certificate — one per contract carrying gamma–zeta
     * (contracts carry access, 2026-10-15). Absent only from an older server.
     */
    typeYs?: PermissionCert[];
    /**
     * Managerial pages' scope: the union of every place the user's gamma-and-above
     * contracts reach. Built from hr.user_contracts (2026-10-18), not the mirror.
     */
    allowed_scope_tree: ScopeTree;
    /**
     * The personal scope: every sub-department the user holds an active contract
     * in (access suites, 2026-10-14). A Type X certificate names no place of its
     * own any more. Absent only from a server older than that change.
     */
    contracted_scope_tree?: ScopeTree;
    /**
     * The Timesheets page's scope: the managerial reach plus each Team Lead (beta)
     * contract's sub-department (2026-10-18). Absent from an older server.
     */
    timesheet_scope_tree?: ScopeTree;
}

// =============================================
// Scope filter selection (emitted by GlobalScopeFilter)
// =============================================

export interface ScopeSelection {
    org_ids: string[];
    dept_ids: string[];
    subdept_ids: string[];
}

// =============================================
// Resolved Scope (output of Scope Resolution Engine)
// =============================================

interface ResolvedScope {
    /** The scope tree of allowed options */
    allowedScopeTree: ScopeTree;
    /** Whether the organization field is locked (not selectable) */
    organizationLocked: boolean;
    /** Whether the department field is locked */
    departmentLocked: boolean;
    /** Whether the sub-department field is locked */
    subDepartmentLocked: boolean;
    /** Whether multi-select is enabled (true for Alpha/Beta personal certs) */
    multiSelectEnabled: boolean;
    /** Whether the entire filter should be hidden (e.g. Gamma fully locked) */
    hidden: boolean;
}

export interface User {
    id: string;
    employeeCode: string | null;
    firstName: string;
    lastName: string | null;
    fullName: string;
    name: string; // Alias for fullName
    email: string;
    systemRole: Role;
    role: Role; // Alias for systemRole
    employmentType: string;
    isActive: boolean;
    avatar?: string;
    contracts: UserContract[];
    certificates: AccessCertificate[];
    highestAccessLevel: AccessLevel;
    preferences?: {
        appearance?: {
            brand_color?: string;
            chart_style?: string;
            language?: string;
            cookie_banner?: string;
        };
        notifications?: {
            email?: boolean;
            push?: boolean;
            browser?: boolean;
        };
    };
}
