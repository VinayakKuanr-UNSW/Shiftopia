
import { supabase } from '@/platform/realtime/client';
import { Employee } from '../model/employee.types';

/**
 * Employee Service
 * 
 * Fetches employee data from the profiles table.
 */
export const employeeService = {
    getAllEmployees: async (): Promise<Employee[]> => {
        const { data, error } = await supabase
            .from('profiles')
            .select(`
                id, 
                first_name, 
                last_name, 
                full_name, 
                email, 
                avatar_url,
                user_contracts (
                    id,
                    organization_id,
                    department_id,
                    sub_department_id,
                    status
                )
            `)
            .order('full_name');

        if (error) {
            console.error('[employeeService] Error fetching employees:', error);
            return [];
        }

        const now = new Date().toISOString();
        return (data || []).map(p => ({
            id: p.id,
            firstName: p.first_name || '',
            lastName: p.last_name || '',
            fullName: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
            email: p.email || '',
            avatarUrl: p.avatar_url,
            is_active: true,
            createdAt: now,
            updatedAt: now,
            contracts: p.user_contracts as any
        }));
    },

    getEmployeeById: async (id: string): Promise<Employee | null> => {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, email, avatar_url')
            .eq('id', id)
            .single();

        if (error || !data) {
            return null;
        }

        const now = new Date().toISOString();
        return {
            id: data.id,
            firstName: data.first_name || '',
            lastName: data.last_name || '',
            fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown',
            email: data.email || '',
            avatarUrl: data.avatar_url,
            is_active: true,
            createdAt: now,
            updatedAt: now
        };
    },

    getEmployeesByDepartment: async (department: string): Promise<Employee[]> => {
        // TODO: Add department filtering when contracts are properly linked
        return employeeService.getAllEmployees();
    },

    getAvailableEmployeesForShift: async (
        date: string,
        department: string,
        role: string,
        startTime: string,
        endTime: string
    ): Promise<Employee[]> => {
        // TODO: Add availability filtering
        return employeeService.getAllEmployees();
    }
};
