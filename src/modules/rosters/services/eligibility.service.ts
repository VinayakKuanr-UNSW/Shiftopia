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

import { supabase } from '@/platform/realtime/client';
import { isValidUuid } from '../domain/shift.entity';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EligibilityContext {
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    roleId?: string;
}

export interface EligibleEmployee {
    id: string;
    first_name: string;
    last_name: string;
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
            let query = supabase
                .from('user_contracts')
                .select(`
                    user_id,
                    profiles:profiles!user_id (
                        id,
                        first_name,
                        last_name
                    )
                `)
                .eq('status', 'Active');

            // Org filter
            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('organization_id', context.organizationId);
            }

            // Dept / Sub-dept filter
            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                query = query.eq('department_id', context.departmentId)
                    .or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`);
            } else if (context.departmentId && isValidUuid(context.departmentId)) {
                query = query.eq('department_id', context.departmentId);
            }

            // Role filter — the key addition
            if (context.roleId && isValidUuid(context.roleId)) {
                query = query.eq('role_id', context.roleId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[EligibilityService] Error fetching contracts:', error);
                return [];
            }

            // Deduplicate by user_id (an employee may have multiple contracts)
            const profilesMap = new Map<string, EligibleEmployee>();
            data?.forEach(row => {
                const profile = (row as { profiles?: EligibleEmployee | null }).profiles;
                if (profile?.id) {
                    profilesMap.set(profile.id, profile);
                }
            });

            return Array.from(profilesMap.values())
                .sort((a, b) => a.last_name.localeCompare(b.last_name));
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
                .select('user_id, role_id')
                .eq('status', 'Active');

            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('organization_id', context.organizationId);
            }

            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                query = query.eq('department_id', context.departmentId)
                    .or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`);
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
            let query = supabase
                .from('user_contracts')
                .select(`
                    user_id,
                    profiles:profiles!user_contracts_user_id_profiles_fkey (
                        id,
                        first_name,
                        last_name
                    ),
                    role:roles!user_contracts_role_id_fkey (
                        name,
                        code
                    )
                `)
                .eq('status', 'Active');

            if (context.organizationId && isValidUuid(context.organizationId)) {
                query = query.eq('organization_id', context.organizationId);
            }

            if (context.subDepartmentId && isValidUuid(context.subDepartmentId)) {
                query = query.eq('department_id', context.departmentId!)
                    .or(`sub_department_id.eq.${context.subDepartmentId},sub_department_id.is.null`);
            } else if (context.departmentId && isValidUuid(context.departmentId)) {
                query = query.eq('department_id', context.departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[EligibilityService] Error fetching contracted staff:', error);
                return [];
            }

            // Deduplicate by user_id — keep first record per person (role from first matching contract)
            const staffMap = new Map<string, ContractedStaffMember>();
            (data ?? []).forEach((row: any) => {
                const profile = row.profiles;
                if (!profile?.id || staffMap.has(profile.id)) return;
                staffMap.set(profile.id, {
                    id: profile.id,
                    first_name: profile.first_name || '',
                    last_name: profile.last_name || '',
                    role_name: row.role?.name ?? null,
                    role_code: row.role?.code ?? null,
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
