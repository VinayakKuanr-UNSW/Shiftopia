/**
 * EligibilityService — Central contract-based eligibility logic
 *
 * Determines which employees are eligible for shift assignment based on
 * their active position contracts (user_contracts).
 *
 * Business Rule:
 *   An employee is eligible if they have an Active user_contract that matches
 *   organization, department, sub_department, AND role.
 *
 * Edge cases:
 *   - roleId is null/undefined    → returns ALL employees in the org/dept scope
 *   - sub_department is optional  → filters by sub_department OR null
 *   - multiple active contracts   → employee appears once (deduplicated by user_id)
 *   - future/expired contracts    → only status = 'Active' is considered
 *
 * Consumers:
 *   - shifts.queries.ts  → getEmployees()
 *   - autoschedule.api.ts → fetchBaseline()
 */

import { supabase } from '@/platform/supabase/client';
import { isValidUuid } from '../domain/shift.entity';
import { isFlexibleEmploymentStatus } from '@/modules/core/model/employment.types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EligibilityContext {
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    roleId?: string;
    skills?: string[];
    licenses?: string[];
    /** Case-insensitive substring match against first_name OR last_name. */
    searchTerm?: string;
    /** Cap result set size. Default: unbounded (caller should set this for grid views). */
    limit?: number;
}

export interface EligibleEmployee {
    id: string;
    first_name: string;
    last_name: string;
    department_name?: string;
    sub_department_name?: string;
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
    /**
     * The in-scope contract's raw `employment_status`. Kept ALONGSIDE
     * `contract_type` because that field collapses 'Flexible Part-Time' onto
     * 'PT' and callers that need the distinction (the employment-target filter,
     * the assignment picker's badges) cannot recover it afterwards.
     */
    employment_status?: string | null;
    /** Convenience mirror of `isFlexibleEmploymentStatus(employment_status)`. */
    is_flexible?: boolean;
    contracted_role_ids?: string[];
    contracted_weekly_hours?: number;
}

export interface EligibleContract {
    user_id: string;
    role_id: string | null;
}

export interface ContractedStaffMember {
    id: string;
    first_name: string;
    last_name: string;
    role_name: string | null;
    role_code: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const EligibilityService = {
    /**
     * Returns deduplicated list of employees who have an Active contract
     * matching the given context (org/dept/sub-dept/role).
     */
    async getEligibleEmployees(context: EligibilityContext): Promise<EligibleEmployee[]> {
        try {
            // We start from profiles to ensure we can find all users, 
            // but we use an inner join on user_contracts to maintain organizational scoping.
            // By removing the .eq('status', 'Active') filter, we include all members 
            // regardless of their current contract state (Expired, Pending, etc).
            let query = supabase
                .from('profiles')
                .select(`
                    id,
                    first_name,
                    last_name,
                    contracts:user_contracts!inner (
                        organization_id,
                        department_id,
                        sub_department_id,
                        role_id,
                        status,
                        employment_status,
                        contracted_weekly_hours,
                        department:departments(name),
                        sub_department:sub_departments(name)
                    ),
                    employee_skills:employee_skills (
                        skill_id,
                        status
                    ),
                    employee_licenses:employee_licenses (
                        license_id,
                        status,
                        verification_status
                    )
                `);

            // Org filter
            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('contracts.organization_id', context.organizationId);
            }

            // Dept / Sub-dept filter
            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                if (context.departmentId && isValidUuid(context.departmentId)) {
                    query = query.eq('contracts.department_id', context.departmentId);
                }
                query = query.or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`, { foreignTable: 'contracts' });
            } else if (context.departmentId && isValidUuid(context.departmentId)) {
                query = query.eq('contracts.department_id', context.departmentId);
            }

            // Role filter — only apply if explicitly requested (usually from role-specific lookups)
            if (context.roleId && isValidUuid(context.roleId)) {
                query = query.eq('contracts.role_id', context.roleId);
            }

            // Server-side name search (substring, case-insensitive on either name)
            const trimmedSearch = context.searchTerm?.trim();
            if (trimmedSearch) {
                const escaped = trimmedSearch.replace(/[%,()]/g, ' ');
                query = query.or(
                    `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`
                );
            }

            // Order at the DB level so .limit() returns a deterministic top-N slice
            query = query.order('last_name', { ascending: true });

            if (typeof context.limit === 'number' && context.limit > 0) {
                // Over-fetch slightly because dedup-by-user happens client-side
                // (a single profile may have multiple matching contract rows).
                query = query.limit(context.limit * 2);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[EligibilityService] Error fetching eligible profiles:', error);
                return [];
            }

            // Deduplicate by user_id
            const profilesMap = new Map<string, EligibleEmployee>();
            (data as any[])?.forEach(row => {
                if (!row.id || profilesMap.has(row.id)) return;
                
                // Get the most relevant contract for display metadata (prefer Active if possible)
                const contracts = Array.isArray(row.contracts) ? row.contracts : [row.contracts];
                const activeContracts = contracts.filter((c: any) => c.status === 'Active' || c.status === 'active');
                if (activeContracts.length === 0) return; // Must have an active contract!

                // Org match verification
                if (context.organizationId && isValidUuid(context.organizationId)) {
                    const hasOrg = activeContracts.some((c: any) => c.organization_id === context.organizationId);
                    if (!hasOrg) return;
                }

                // Dept match verification
                if (context.departmentId && isValidUuid(context.departmentId)) {
                    const hasDept = activeContracts.some((c: any) => c.department_id === context.departmentId);
                    if (!hasDept) return;
                }

                // SubDept match verification (must match or contract has null subdept)
                if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                    const hasSubDept = activeContracts.some((c: any) => c.sub_department_id === context.subDepartmentId || c.sub_department_id === null);
                    if (!hasSubDept) return;
                }

                // Role match verification
                if (context.roleId && isValidUuid(context.roleId)) {
                    const hasRole = activeContracts.some((c: any) => c.role_id === context.roleId);
                    if (!hasRole) return;
                }

                // Employment status is a property of the CONTRACT, not the person:
                // the same profile can be Casual in one sub-department and Part-Time
                // in another. So `employment_status` below must be read from a
                // contract that is in scope for THIS lookup, not from whichever
                // active contract happened to sort first.
                //
                // A contract with sub_department_id === null is org/dept-wide and
                // therefore in scope for every sub-department under it — the same
                // rule the SubDept verification above already applies. Excluding
                // those would hide staff who are legitimately assignable.
                const scopedContracts = (context.subDepartmentId && isValidUuid(context.subDepartmentId))
                    ? activeContracts.filter((c: any) =>
                        c.sub_department_id === context.subDepartmentId || c.sub_department_id === null)
                    : activeContracts;

                // Skills match verification
                if (context.skills && context.skills.length > 0) {
                    const empSkills = row.employee_skills || [];
                    const activeSkillIds = empSkills
                        .filter((es: any) => es.status === 'Active' || es.status === 'active')
                        .map((es: any) => es.skill_id);
                    const hasAllSkills = context.skills.every((reqSkillId: string) => activeSkillIds.includes(reqSkillId));
                    if (!hasAllSkills) return;
                }

                // Certifications/Licenses match verification
                if (context.licenses && context.licenses.length > 0) {
                    const empLicenses = row.employee_licenses || [];
                    const activeLicenseIds = empLicenses
                        .filter((el: any) => 
                            (el.status === 'Active' || el.status === 'active') && 
                            el.verification_status !== 'Expired' && 
                            el.verification_status !== 'Failed'
                        )
                        .map((el: any) => el.license_id);
                    const hasAllLicenses = context.licenses.every((reqLicenseId: string) => activeLicenseIds.includes(reqLicenseId));
                    if (!hasAllLicenses) return;
                }

                // Prefer a contract that is actually in scope for this lookup — with
                // multiple active contracts, activeContracts[0] could describe a
                // different sub-department than the one being planned.
                const displayContract = scopedContracts[0] || activeContracts[0] || contracts[0];

                profilesMap.set(row.id, {
                    id: row.id,
                    first_name: row.first_name,
                    last_name: row.last_name,
                    department_name: displayContract?.department?.name,
                    sub_department_name: displayContract?.sub_department?.name,
                    contract_type: displayContract?.employment_status === 'Full-Time' ? 'FT' :
                                  displayContract?.employment_status === 'Part-Time' ? 'PT' :
                                  displayContract?.employment_status === 'Casual' ? 'CASUAL' :
                                  displayContract?.employment_status === 'Flexible Part-Time' ? 'PT' : null,
                    employment_status: displayContract?.employment_status ?? null,
                    is_flexible: isFlexibleEmploymentStatus(displayContract?.employment_status),
                    contracted_role_ids: Array.from(new Set(activeContracts.map((c: any) => c.role_id).filter(Boolean))),
                    contracted_weekly_hours: displayContract?.contracted_weekly_hours ?? 38
                } as EligibleEmployee);
            });

            const result = Array.from(profilesMap.values())
                .sort((a, b) => a.last_name.localeCompare(b.last_name));
            return typeof context.limit === 'number' && context.limit > 0
                ? result.slice(0, context.limit)
                : result;
        } catch (error) {
            console.error('[EligibilityService] Exception:', error);
            return [];
        }
    },

    /**
     * Returns raw contract rows (user_id + role_id) for the auto-scheduler's
     * per-shift role matching. This avoids fetching full profile data when
     * only contract eligibility is needed.
     */
    async getEligibleContracts(context: Omit<EligibilityContext, 'roleId'>): Promise<EligibleContract[]> {
        try {
            let query = supabase
                .from('user_contracts')
                .select('user_id, role_id');

            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('organization_id', context.organizationId);
            }

            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                if (context.departmentId && isValidUuid(context.departmentId)) {
                    query = query.eq('department_id', context.departmentId);
                }
                query = query.or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`);
            } else if (context.departmentId && isValidUuid(context.departmentId)) {
                query = query.eq('department_id', context.departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[EligibilityService] Error fetching contracts:', error);
                return [];
            }

            return (data ?? []) as EligibleContract[];
        } catch (error) {
            console.error('[EligibilityService] Exception:', error);
            return [];
        }
    },

    /**
     * Returns all contracted staff for the given scope, enriched with role name + code.
     * Used by the Group Mode and Roles Mode side panel ("Contracted Staff").
     * Note: roles table has no color column — role_code is used for UI colour derivation.
     */
    async getContractedStaff(context: Omit<EligibilityContext, 'roleId'>): Promise<ContractedStaffMember[]> {
        try {
            // public.user_contracts is a VIEW over hr.user_contracts and carries no
            // FK metadata, so PostgREST can't embed profiles/roles through it. Fetch
            // scalar rows here and resolve the names in a second pass below.
            let query = supabase
                .from('user_contracts')
                .select('user_id, role_id');

            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('organization_id', context.organizationId);
            }

            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                if (context.departmentId && isValidUuid(context.departmentId)) {
                    query = query.eq('department_id', context.departmentId);
                }
                query = query.or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`);
            } else if (context.departmentId && isValidUuid(context.departmentId)) {
                query = query.eq('department_id', context.departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[EligibilityService] Error fetching contracted staff:', error);
                return [];
            }

            const rows = (data ?? []) as Array<{ user_id: string; role_id: string | null }>;
            const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
            const roleIds = [...new Set(rows.map(r => r.role_id).filter((v): v is string => !!v))];

            // Resolve names separately (profiles is a real table; roles is the
            // public compat view over hr.roles — both queryable by id).
            const [profilesRes, rolesRes] = await Promise.all([
                userIds.length
                    ? supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
                    : Promise.resolve({ data: [] as any[] }),
                roleIds.length
                    ? supabase.from('roles').select('id, name, code').in('id', roleIds)
                    : Promise.resolve({ data: [] as any[] }),
            ]);

            const profileById = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
            const roleById = new Map((rolesRes.data ?? []).map((r: any) => [r.id, r]));

            // Deduplicate by user_id
            const staffMap = new Map<string, ContractedStaffMember>();
            rows.forEach((row) => {
                const profile = profileById.get(row.user_id);
                if (!profile?.id || staffMap.has(profile.id)) return;

                const role = row.role_id ? roleById.get(row.role_id) : null;
                staffMap.set(profile.id, {
                    id: profile.id,
                    first_name: profile.first_name || '',
                    last_name: profile.last_name || '',
                    role_name: role?.name ?? null,
                    role_code: role?.code ?? null,
                });
            });

            return Array.from(staffMap.values())
                .sort((a, b) => a.last_name.localeCompare(b.last_name));
        } catch (error) {
            console.error('[EligibilityService] Exception in getContractedStaff:', error);
            return [];
        }
    },
};
