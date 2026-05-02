import { useState } from 'react';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { AccessLevel } from '@/platform/auth/types';

export interface ContractFormState {
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    rem_level_id: string;
    employment_status: string;
}

const INITIAL_STATE: ContractFormState = {
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_id: '',
    rem_level_id: '',
    employment_status: 'Full-Time',
};

export const useContractForm = (employeeId: string, onSuccess?: () => void) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<ContractFormState>(INITIAL_STATE);

    // Cascading updates
    const updateField = (field: keyof ContractFormState, value: string) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };

            // Cascading resets
            if (field === 'organization_id') {
                next.department_id = '';
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'department_id') {
                next.sub_department_id = '';
                next.role_id = '';
            } else if (field === 'sub_department_id') {
                next.role_id = '';
            }

            return next;
        });
    };

    // Auto-select rem level when role changes
    const updateRole = (roleId: string, linkedRemLevelId?: string, employmentType?: string) => {
        setFormData(prev => {
            let nextStatus = prev.employment_status;
            if (employmentType) {
                const lower = employmentType.toLowerCase();
                const statuses: string[] = [];
                if (lower.includes('full time')) statuses.push('Full-Time');
                if (lower.includes('part time')) statuses.push('Part-Time');
                if (lower.includes('casual')) statuses.push('Casual');
                if (lower.includes('flexible')) statuses.push('Flexible Part-Time');
                
                if (statuses.length > 0) {
                    // Default to the first allowed status
                    if (!statuses.includes(nextStatus)) {
                        nextStatus = statuses[0];
                    }
                }
            }

            return {
                ...prev,
                role_id: roleId,
                rem_level_id: linkedRemLevelId || prev.rem_level_id,
                employment_status: nextStatus
            };
        });
    };

    const validate = (): string[] => {
        const missing: string[] = [];
        if (!formData.organization_id) missing.push('Organization');
        if (!formData.department_id) missing.push('Department');
        if (!formData.sub_department_id) missing.push('Sub-Department');
        if (!formData.role_id) missing.push('Role');
        if (!formData.rem_level_id) missing.push('Remuneration Level');
        return missing;
    };

    const submit = async () => {
        const missing = validate();
        if (missing.length > 0) {
            toast({
                title: 'Validation Error',
                description: `Please select the following: ${missing.join(', ')}`,
                variant: 'destructive'
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            const { error } = await (supabase as any).from('user_contracts').insert({
                user_id: employeeId,
                ...formData,
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Contract added successfully' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });

            // Partial Reset
            setFormData(prev => ({
                ...prev,
                role_id: '',
                rem_level_id: '',
            }));

            if (onSuccess) onSuccess();
            return true;
        } catch (error: any) {
            console.error('Error adding contract:', error);
            toast({ title: 'Error', description: error.message || 'Failed to add contract', variant: 'destructive' });
            return false;
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        formData,
        isSubmitting,
        updateField,
        updateRole,
        submit,
        setFormData
    };
};
