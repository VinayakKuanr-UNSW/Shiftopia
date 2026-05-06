import { useState } from 'react';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export interface ContractFormState {
    organization_id: string;
    department_id: string;
    sub_department_id: string;
    role_id: string;
    rem_level_id: string;
    employment_status: string;
    contracted_weekly_hours: number;
}

const INITIAL_STATE: ContractFormState = {
    organization_id: '',
    department_id: '',
    sub_department_id: '',
    role_id: '',
    rem_level_id: '',
    employment_status: '',
    contracted_weekly_hours: 0,
};

export const useContractForm = (employeeId: string, onSuccess?: () => void) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<ContractFormState>(INITIAL_STATE);

    const updateField = (field: keyof ContractFormState, value: any) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };

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

            // Auto-update hours based on status
            if (field === 'employment_status') {
                if (value === 'Full-Time') next.contracted_weekly_hours = 38;
                else if (value === 'Part-Time' || value === 'Flexible Part-Time') next.contracted_weekly_hours = 20;
                else next.contracted_weekly_hours = 0;
            }

            return next;
        });
    };

    const updateRole = (roleId: string, linkedRemLevelId?: string, employmentType?: string) => {
        setFormData(prev => {
            let nextStatus = prev.employment_status;
            if (employmentType) {
                const lower = employmentType.toLowerCase();
                if (lower.includes('full time')) nextStatus = 'Full-Time';
                else if (lower.includes('part time')) nextStatus = 'Part-Time';
                else if (lower.includes('casual')) nextStatus = 'Casual';
            }

            let nextHours = prev.contracted_weekly_hours;
            if (nextStatus === 'Full-Time') nextHours = 38;
            else if (nextStatus === 'Part-Time' || nextStatus === 'Flexible Part-Time') nextHours = 20;
            else nextHours = 0;

            return {
                ...prev,
                role_id: roleId,
                rem_level_id: linkedRemLevelId || prev.rem_level_id,
                employment_status: nextStatus,
                contracted_weekly_hours: nextHours
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
                organization_id: formData.organization_id,
                department_id: formData.department_id,
                sub_department_id: formData.sub_department_id,
                role_id: formData.role_id,
                rem_level_id: formData.rem_level_id,
                employment_status: formData.employment_status,
                contracted_weekly_hours: formData.contracted_weekly_hours
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Contract added successfully' });
            queryClient.invalidateQueries({ queryKey: ['user_contracts', employeeId] });

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
