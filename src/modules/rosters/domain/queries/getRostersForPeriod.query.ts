/**
 * Get Rosters For Period Query
 * Domain layer - fetches rosters for a date range
 */

import { supabase } from '@/platform/realtime/client';

export interface RosterSummary {
    id: string;
    shiftDate: string;
    departmentId: string;
    subDepartmentId: string;
    status: 'draft' | 'published';
    createdAt: string;
    createdBy?: string;
    finalizedAt?: string;
}

export interface GetRostersInput {
    departmentId: string;
    subDepartmentId: string;
    startDate: string;
    endDate: string;
}

/**
 * Fetch rosters for a given period and department/sub-department
 */
export async function getRostersForPeriod(
    input: GetRostersInput
): Promise<RosterSummary[]> {
    const { departmentId, subDepartmentId, startDate, endDate } = input;

    if (!departmentId || !subDepartmentId) {
        return [];
    }

    const { data, error } = await supabase
        .from('rosters')
        .select('id, shift_date, department_id, sub_department_id, status, created_at, created_by, finalized_at')
        .eq('department_id', departmentId)
        .eq('sub_department_id', subDepartmentId)
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .order('shift_date', { ascending: false });

    if (error) {
        console.error('[getRostersForPeriod] Error:', error);
        return [];
    }

    return (data || []).map((r) => ({
        id: r.id,
        shiftDate: r.shift_date,
        departmentId: r.department_id,
        subDepartmentId: r.sub_department_id,
        status: (r.status || 'draft') as 'draft' | 'published',
        createdAt: r.created_at || '',
        createdBy: r.created_by || undefined,
        finalizedAt: r.finalized_at || undefined,
    }));
}

/**
 * Fetch a single roster by ID
 */
export async function getRosterById(
    rosterId: string
): Promise<RosterSummary | null> {
    if (!rosterId) return null;

    const { data, error } = await supabase
        .from('rosters')
        .select('id, shift_date, department_id, sub_department_id, status, created_at, created_by, finalized_at')
        .eq('id', rosterId)
        .single();

    if (error || !data) {
        console.error('[getRosterById] Error:', error);
        return null;
    }

    return {
        id: data.id,
        shiftDate: data.shift_date,
        departmentId: data.department_id,
        subDepartmentId: data.sub_department_id,
        status: (data.status || 'draft') as 'draft' | 'published',
        createdAt: data.created_at || '',
        createdBy: data.created_by || undefined,
        finalizedAt: data.finalized_at || undefined,
    };
}
