import { supabase } from '@/platform/realtime/client';
import { Shift, ShiftStatus, TemplateGroupType, isValidUuid } from '../domain/shift.entity';

export const shiftsQueries = {
    /* ============================================================
       GET SHIFT BY ID
       ============================================================ */

    async getShiftById(shiftId: string): Promise<Shift | null> {
        const { data, error } = await supabase
            .from('shifts')
            .select(
                `
        *,
        assignment_outcome,
        organizations(id, name),
        departments(id, name),
        sub_departments(id, name),
        roles(id, name),
        remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
        assigned_profiles:profiles!assigned_employee_id(first_name, last_name)
      `
            )
            .eq('id', shiftId)
            .is('deleted_at', null)
            .single();

        if (error) {
            console.error('Error fetching shift:', error);
            return null;
        }
        return data as unknown as Shift;
    },

    /* ============================================================
       GET SHIFTS FOR ROSTER/DATE
       ============================================================ */

    async getShiftsForDate(
        organizationId: string,
        date: string,
        filters?: {
            departmentId?: string;
            subDepartmentId?: string;
            departmentIds?: string[];
            subDepartmentIds?: string[];
            groupType?: TemplateGroupType;
            status?: ShiftStatus;
        }
    ): Promise<Shift[]> {
        if (!isValidUuid(organizationId)) {
            console.warn(
                'Invalid organization ID for getShiftsForDate:',
                organizationId
            );
            return [];
        }

        try {
            let query = supabase
                .from('shifts')
                .select(
                    `
          *,
        assignment_outcome,
          organizations(id, name),
          departments(id, name),
          sub_departments(id, name),
        roles(id, name),
        remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
        assigned_profiles:profiles!assigned_employee_id(first_name, last_name)
        `
                )
                .eq('organization_id', organizationId)
                .eq('shift_date', date)
                .is('deleted_at', null)
                .order('display_order')
                .order('start_time');

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.eq('department_id', filters.departmentId);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                query = query.in('department_id', filters.departmentIds.filter(id => isValidUuid(id)));
            }
            if (filters?.subDepartmentId && isValidUuid(filters.subDepartmentId)) {
                query = query.eq('sub_department_id', filters.subDepartmentId);
            } else if (filters?.subDepartmentIds && filters.subDepartmentIds.length > 0) {
                query = query.in('sub_department_id', filters.subDepartmentIds.filter(id => isValidUuid(id)));
            }
            if (filters?.groupType) {
                query = (query as any).eq('group_type', filters.groupType);
            }
            if (filters?.status) {
                query = (query as any).eq('status', filters.status);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching shifts:', error);
                return [];
            }
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('Exception in getShiftsForDate:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFTS FOR DATE RANGE (Week/Month views)
       ============================================================ */

    async getShiftsForDateRange(
        organizationId: string,
        startDate: string,
        endDate: string,
        filters?: {
            departmentId?: string;
            subDepartmentId?: string;
            departmentIds?: string[];
            subDepartmentIds?: string[];
            groupType?: TemplateGroupType;
            status?: ShiftStatus;
        }
    ): Promise<Shift[]> {
        if (!isValidUuid(organizationId)) {
            console.warn(
                'Invalid organization ID for getShiftsForDateRange:',
                organizationId
            );
            return [];
        }

        try {
            let query = supabase
                .from('shifts')
                .select(
                    `
          *,
        assignment_outcome,
          organizations(id, name),
          departments(id, name),
          sub_departments(id, name),
        roles(id, name),
        remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
        assigned_profiles:profiles!assigned_employee_id(first_name, last_name)
        `
                )
                .eq('organization_id', organizationId)
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .order('shift_date')
                .order('display_order')
                .order('start_time');

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.eq('department_id', filters.departmentId);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                query = query.in('department_id', filters.departmentIds.filter(id => isValidUuid(id)));
            }
            if (filters?.subDepartmentId && isValidUuid(filters.subDepartmentId)) {
                query = query.eq('sub_department_id', filters.subDepartmentId);
            } else if (filters?.subDepartmentIds && filters.subDepartmentIds.length > 0) {
                query = query.in('sub_department_id', filters.subDepartmentIds.filter(id => isValidUuid(id)));
            }
            if (filters?.groupType) {
                query = (query as any).eq('group_type', filters.groupType);
            }
            if (filters?.status) {
                query = (query as any).eq('status', filters.status);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching shifts for date range:', error);
                return [];
            }
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('Exception in getShiftsForDateRange:', error);
            return [];
        }
    },

    /* ============================================================
       GET SHIFTS FOR EMPLOYEE
       ============================================================ */

    async getEmployeeShifts(
        employeeId: string,
        startDate: string,
        endDate: string
    ): Promise<Shift[]> {
        if (!isValidUuid(employeeId)) return [];

        try {
            const { data, error } = await supabase
                .from('shifts')
                .select(
                    `
          *,
          assignment_outcome,
          organizations(id, name),
          departments(id, name),
          sub_departments(id, name),
          roles(id, name),
          remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max),
          assigned_profiles:profiles!assigned_employee_id(first_name, last_name),
          roster_subgroup:roster_subgroups(name, roster_group:roster_groups(name, external_id))
        `
                )
                .eq('assigned_employee_id', employeeId)
                // Only show Published shifts (no drafts)
                .eq('lifecycle_status', 'Published')
                // Exclude offers (S3) - they should only appear in My Offers
                .neq('assignment_outcome', 'offered')
                .gte('shift_date', startDate)
                .lte('shift_date', endDate)
                .is('deleted_at', null)
                .order('shift_date')
                .order('start_time');

            if (error) {
                console.error('Error fetching employee shifts:', error);
                return [];
            }
            return (data || []) as unknown as Shift[];
        } catch (error) {
            console.error('Exception in getEmployeeShifts:', error);
            return [];
        }
    },

    /* ============================================================
       LOOKUPS
       ============================================================ */

    async getOrganizations(): Promise<any[]> {
        try {
            const { data, error } = await supabase
                .from('organizations')
                .select('id, name')
                .order('name');

            if (error) {
                console.error('Error fetching organizations:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getOrganizations:', error);
            return [];
        }
    },

    async getDepartments(organizationId?: string): Promise<any[]> {
        try {
            let query = supabase
                .from('departments')
                .select('id, name, organization_id')
                .order('name');

            if (organizationId && isValidUuid(organizationId)) {
                query = query.eq('organization_id', organizationId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching departments:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getDepartments:', error);
            return [];
        }
    },

    async getSubDepartments(departmentId?: string): Promise<any[]> {
        try {
            if (departmentId && !isValidUuid(departmentId)) {
                console.warn(
                    'Invalid department ID for getSubDepartments:',
                    departmentId
                );
                return [];
            }

            let query = supabase
                .from('sub_departments')
                .select('id, name, department_id')
                .order('name');

            if (departmentId) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching sub_departments:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getSubDepartments:', error);
            return [];
        }
    },

    async getRoles(departmentId?: string, subDepartmentId?: string): Promise<any[]> {
        try {
            let query = supabase
                .from('roles')
                .select('id, name, department_id, sub_department_id, remuneration_level_id')
                .order('name');

            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                if (departmentId && isValidUuid(departmentId)) {
                    // Fetch roles specific to sub-department OR general roles for the department
                    query = query.or(`sub_department_id.eq.${subDepartmentId},and(department_id.eq.${departmentId},sub_department_id.is.null)`);
                } else {
                    query = query.eq('sub_department_id', subDepartmentId);
                }
            } else if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching roles:', error);
                // Fallback to all roles on error to prevent broken UI
                const { data: allRoles } = await supabase
                    .from('roles')
                    .select('id, name, department_id, sub_department_id, remuneration_level_id')
                    .order('name');
                return allRoles || [];
            }

            return data || [];
        } catch (error) {
            console.error('Exception in getRoles:', error);
            return [];
        }
    },

    async getTemplates(subDepartmentId?: string, departmentId?: string): Promise<any[]> {
        try {
            // Query roster_templates (published templates) not shift_templates
            let query = supabase
                .from('roster_templates')
                .select('id, name, description, department_id, sub_department_id, status, published_month, start_date, end_date')
                .eq('status', 'published') // Only show published templates with valid date ranges
                .order('name');

            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                query = query.eq('sub_department_id', subDepartmentId);
            } else if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching templates:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getTemplates:', error);
            return [];
        }
    },

    async getRemunerationLevels(): Promise<any[]> {
        try {
            const { data, error } = await supabase
                .from('remuneration_levels')
                .select(
                    'id, level_number, level_name, hourly_rate_min, hourly_rate_max, description'
                )
                .order('level_number');

            if (error) {
                console.error('Error fetching remuneration_levels:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getRemunerationLevels:', error);
            return [];
        }
    },

    async getEmployees(organizationId?: string): Promise<any[]> {
        try {
            // Try 'profiles' table first
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('id, first_name, last_name')
                .order('last_name');

            if (!profilesError && profilesData && profilesData.length > 0) {
                let result = profilesData;
                if (organizationId && isValidUuid(organizationId)) {
                    // Client-side filter if organization_id exists on profile, otherwise return all (or specific logic)
                    // Since specific column fetch failed, we assume profiles are restricted by RLS to the user's org anyway
                    result = result.filter(
                        (p: any) => !p.organization_id || p.organization_id === organizationId
                    );
                }
                return result;
            }

            console.warn('No profiles found');
            return [];

            console.warn('No employee/profile/user table found');
            return [];
        } catch (error) {
            console.error('Exception in getEmployees:', error);
            return [];
        }
    },

    async getSkills(): Promise<any[]> {
        try {
            const { data, error } = await supabase
                .from('skills')
                .select('id, name, description, category')
                .eq('is_active', true)
                .order('category')
                .order('name');

            if (error) {
                console.error('Error fetching skills:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getSkills:', error);
            return [];
        }
    },

    async getLicenses(): Promise<any[]> {
        try {
            const { data, error } = await supabase
                .from('licenses')
                .select('id, name, description, category, issuing_authority')
                .eq('is_active', true)
                .order('category')
                .order('name');

            if (error) {
                console.error('Error fetching licenses:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getLicenses:', error);
            return [];
        }
    },

    async getEvents(organizationId?: string): Promise<any[]> {
        try {
            let query = supabase
                .from('events')
                .select(
                    'id, name, description, event_type, venue, start_date, end_date, status'
                )
                .eq('is_active', true)
                .order('start_date', { ascending: true });

            if (organizationId && isValidUuid(organizationId)) {
                query = query.eq('organization_id', organizationId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching events:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getEvents:', error);
            return [];
        }
    },

    async getRosters(organizationId: string, filters?: {
        departmentId?: string;
        departmentIds?: string[];
        subDepartmentIds?: string[]
    }): Promise<any[]> {
        try {
            if (!isValidUuid(organizationId)) {
                return [];
            }

            let query = supabase
                .from('rosters')
                .select(`
                    id, 
                    name, 
                    start_date, 
                    end_date,
                    groups:roster_groups(
                        id, 
                        name, 
                        subGroups:roster_subgroups(id, name)
                    )
                `)
                .order('start_date', { ascending: false });

            if (isValidUuid(organizationId)) {
                query = query.eq('organization_id', organizationId);
            }

            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.eq('department_id', filters.departmentId);
            } else if (filters?.departmentIds && filters.departmentIds.length > 0) {
                query = query.in('department_id', filters.departmentIds.filter(id => isValidUuid(id)));
            }

            if (filters?.subDepartmentIds && filters.subDepartmentIds.length > 0) {
                query = query.in('sub_department_id', filters.subDepartmentIds.filter(id => isValidUuid(id)));
            }

            const { data, error } = await query;

            if (error) {
                console.error('[getRosters] Error fetching rosters:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('[getRosters] Exception:', error);
            return [];
        }
    },

    /**
     * Get the full structure for a specific roster (groups and subgroups)
     */
    async getRosterStructure(rosterId: string): Promise<any[]> {
        try {
            if (!isValidUuid(rosterId)) return [];

            const { data, error } = await supabase
                .from('roster_groups')
                .select(`
                    id,
                    name,
                    subGroups:roster_subgroups(
                        id,
                        name
                    )
                `)
                .eq('roster_id', rosterId)
                .order('sort_order', { ascending: true });

            if (error) {
                console.error('Error fetching roster structure:', error);
                return [];
            }

            if (!data) return [];

            // Flatten the structure for the UI which expects { groupType: string, subGroupName: string }
            const flattened: any[] = [];
            data.forEach((group: any) => {
                const normalizedGroup = group.name.toLowerCase().replace(/\s+/g, '_');
                if (group.subGroups && group.subGroups.length > 0) {
                    group.subGroups.forEach((sub: any) => {
                        flattened.push({
                            groupType: normalizedGroup,
                            subGroupName: sub.name
                        });
                    });
                } else {
                    flattened.push({
                        groupType: normalizedGroup,
                        subGroupName: ''
                    });
                }
            });

            return flattened;
        } catch (error) {
            console.error('Exception in getRosterStructure:', error);
            return [];
        }
    },

    async getShiftAuditLog(shiftId: string): Promise<any[]> {
        try {
            if (!isValidUuid(shiftId)) {
                return [];
            }

            const { data, error } = await supabase
                .from('shift_audit_log')
                .select('*')
                .eq('shift_id', shiftId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching audit log:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getShiftAuditLog:', error);
            return [];
        }
    },

    /**
     * Get count of pending shift offers (S3 - Published + Offered) for an employee
     */
    async getPendingOfferCount(employeeId: string): Promise<number> {
        try {
            if (!isValidUuid(employeeId)) return 0;

            const { count, error } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('assigned_employee_id', employeeId)
                .eq('lifecycle_status', 'Published')
                .eq('assignment_outcome', 'offered')
                .is('deleted_at', null);

            if (error) {
                console.error('Error fetching pending offer count:', error);
                return 0;
            }
            return count || 0;
        } catch (error) {
            console.error('Exception in getPendingOfferCount:', error);
            return 0;
        }
    },

    /**
     * Get shift offers for an employee (S3 - Published + Offered status)
     * Returns shifts that have been offered to this employee and are pending response
     */
    async getMyOffers(employeeId: string, filters?: { organizationId?: string; departmentId?: string }) {
        try {
            if (!isValidUuid(employeeId)) return [];

            let query = supabase
                .from('shifts')
                .select(`
                    id,
                    shift_date,
                    start_time,
                    end_time,
                    notes,
                    assignment_outcome,
                    published_at,
                    roles(name),
                    departments(id, name),
                    sub_departments(name),
                    organizations(id, name),
                    remuneration_levels(level_name, hourly_rate_min)
                `)
                .eq('assigned_employee_id', employeeId)
                .eq('lifecycle_status', 'Published')
                .eq('assignment_outcome', 'offered')
                .is('deleted_at', null)
                .order('shift_date', { ascending: true });

            if (filters?.organizationId && isValidUuid(filters.organizationId)) {
                query = query.eq('organization_id', filters.organizationId);
            }
            if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                query = query.eq('department_id', filters.departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching my offers:', error);
                throw error;
            }

            // Transform to match OfferData interface expected by MyOffersModal
            return (data || []).map(shift => ({
                id: shift.id,
                shift_id: shift.id,
                status: 'Pending' as const,
                offered_at: shift.published_at,
                shift: {
                    id: shift.id,
                    shift_date: shift.shift_date,
                    start_time: shift.start_time,
                    end_time: shift.end_time,
                    roles: shift.roles,
                    departments: shift.departments,
                    sub_departments: shift.sub_departments,
                    organizations: shift.organizations,
                    notes: shift.notes,
                    remuneration_levels: shift.remuneration_levels,
                },
            }));
        } catch (error) {
            console.error('Exception in getMyOffers:', error);
            throw error;
        }
    },

    /**
     * Get offer history (Accepted/Declined) for an employee
     */
    async getMyOfferHistory(employeeId: string, status: 'Accepted' | 'Declined', filters?: { organizationId?: string; departmentId?: string }) {
        try {
            if (!isValidUuid(employeeId)) return [];

            if (status === 'Accepted') {
                // For Accepted: specific logic - assigned to me and confirmed
                // We might want to filter strictly by ones that WERE offers, but 'confirmed' is usually the end state.
                // Simpler approach: Show all confirmed future shifts? Or check audit log?
                // Checking audit log for 'offer_accepted' is most accurate if we want strictly "Accepted Offers".

                // Let's use audit log to find shift IDs, then fetch details.
                const { data: events } = await supabase
                    .from('shift_audit_events')
                    .select('shift_id')
                    .eq('performed_by_id', employeeId)
                    .eq('event_type', 'offer_accepted')
                    .order('created_at', { ascending: false })
                    .limit(50); // Limit usage history

                const shiftIds = events?.map(e => e.shift_id) || [];
                if (shiftIds.length === 0) return [];

                let query = supabase
                    .from('shifts')
                    .select(`
                        id,
                        shift_date,
                        start_time,
                        end_time,
                        notes,
                        assignment_outcome,
                        created_at,
                        roles(name),
                        departments(id, name),
                        sub_departments(name),
                        organizations(id, name),
                        remuneration_levels(level_name, hourly_rate_min)
                    `)
                    .in('id', shiftIds)
                    .is('deleted_at', null)
                    .order('shift_date', { ascending: false }); // Show recent first

                if (filters?.organizationId && isValidUuid(filters.organizationId)) {
                    query = query.eq('organization_id', filters.organizationId);
                }
                if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                    query = query.eq('department_id', filters.departmentId);
                }

                const { data, error } = await query;
                if (error) throw error;

                return (data || []).map(shift => ({
                    id: shift.id,
                    shift_id: shift.id,
                    status: 'Accepted' as const,
                    offered_at: shift.created_at, // Approximate
                    shift: {
                        id: shift.id,
                        shift_date: shift.shift_date,
                        start_time: shift.start_time,
                        end_time: shift.end_time,
                        roles: shift.roles,
                        departments: shift.departments,
                        sub_departments: shift.sub_departments,
                        organizations: shift.organizations,
                        notes: shift.notes,
                        remuneration_levels: shift.remuneration_levels,
                    },
                }));

            } else {
                // Declined: Check audit events for 'offer_declined'
                const { data: events } = await supabase
                    .from('shift_audit_events')
                    .select('shift_id, created_at')
                    .eq('performed_by_id', employeeId)
                    .eq('event_type', 'offer_declined')
                    .order('created_at', { ascending: false })
                    .limit(50);

                const shiftIds = events?.map(e => e.shift_id) || [];
                if (shiftIds.length === 0) return [];

                let query = supabase
                    .from('shifts')
                    .select(`
                        id,
                        shift_date,
                        start_time,
                        end_time,
                        notes,
                        assignment_outcome,
                        roles(name),
                        departments(id, name),
                        sub_departments(name),
                        organizations(id, name),
                        remuneration_levels(level_name, hourly_rate_min)
                    `)
                    .in('id', shiftIds)
                    // Deleted shifts might still be relevant in history, but safer to hide if deleted
                    .is('deleted_at', null)
                    .order('shift_date', { ascending: false });

                if (filters?.organizationId && isValidUuid(filters.organizationId)) {
                    query = query.eq('organization_id', filters.organizationId);
                }
                if (filters?.departmentId && isValidUuid(filters.departmentId)) {
                    query = query.eq('department_id', filters.departmentId);
                }

                const { data, error } = await query;
                if (error) throw error;

                return (data || []).map(shift => ({
                    id: shift.id,
                    shift_id: shift.id,
                    status: 'Declined' as const,
                    offered_at: events?.find(e => e.shift_id === shift.id)?.created_at || new Date().toISOString(),
                    shift: {
                        id: shift.id,
                        shift_date: shift.shift_date,
                        start_time: shift.start_time,
                        end_time: shift.end_time,
                        roles: shift.roles,
                        departments: shift.departments,
                        sub_departments: shift.sub_departments,
                        organizations: shift.organizations,
                        notes: shift.notes,
                        remuneration_levels: shift.remuneration_levels,
                    },
                }));
            }
        } catch (error) {
            console.error('Exception in getMyOfferHistory:', error);
            throw error;
        }
    },

    /**
     * Accept a shift offer (S3 -> S4: Published + Offered -> Published + Confirmed)
     */
    async acceptOffer(shiftId: string) {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase
                .rpc('sm_accept_offer', {
                    p_shift_id: shiftId,
                    p_user_id: user?.id
                });

            if (error) {
                console.error('Error accepting offer:', error);
                throw error;
            }

            return data;

            return data;
        } catch (error) {
            console.error('Exception in acceptOffer:', error);
            throw error;
        }
    },

    /**
     * Decline a shift offer (S3 -> S5/S6: Published + Offered -> On Bidding)
     */
    async declineOffer(shiftId: string) {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase
                .rpc('sm_decline_offer', {
                    p_shift_id: shiftId,
                    p_user_id: user?.id
                });

            if (error) {
                console.error('Error declining offer:', error);
                throw error;
            }

            return data;

            return data;
        } catch (error) {
            console.error('Exception in declineOffer:', error);
            throw error;
        }
    },
    /**
     * Get all open shifts available for bidding (S5/S6)
     */
    /**
     * Get all open shifts available for bidding (S5/S6)
     * Enforces Access Control: Org -> Dept -> SubDept
     */
    async getOpenShifts(filters: {
        organizationId: string;
        departmentId?: string;
        subDepartmentId?: string;
    }): Promise<any[]> {
        try {
            const { organizationId, departmentId, subDepartmentId } = filters;

            if (!isValidUuid(organizationId)) {
                console.warn('Invalid organization ID for getOpenShifts:', organizationId);
                return [];
            }

            let query = supabase
                .from('shifts')
                .select(`
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name),
                    roles(name),
                    remuneration_levels(level_name, hourly_rate_min),
                    profiles:assigned_employee_id(first_name, last_name)
                `)
                .eq('organization_id', organizationId)
                .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent'])
                .is('deleted_at', null)
                .eq('is_cancelled', false)
                .order('shift_date', { ascending: true });

            // Apply Hierarchical Filters
            if (subDepartmentId && isValidUuid(subDepartmentId)) {
                query = query.eq('sub_department_id', subDepartmentId);
            } else if (departmentId && isValidUuid(departmentId)) {
                query = query.eq('department_id', departmentId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching open shifts:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getOpenShifts:', error);
            return [];
        }
    },

    /**
     * Get all bids for a specific shift
     */
    async getShiftBids(shiftId: string): Promise<any[]> {
        try {
            if (!isValidUuid(shiftId)) return [];

            const { data, error } = await supabase
                .from('shift_bids')
                .select(`
                    id, shift_id, employee_id, status, created_at,
                    profiles!shift_bids_employee_id_fkey (
                        id, full_name, first_name, last_name, employment_type
                    )
                `)
                .eq('shift_id', shiftId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching shift bids:', error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.error('Exception in getShiftBids:', error);
            return [];
        }
    },
};
