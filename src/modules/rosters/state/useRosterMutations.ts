import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ROSTER_STRUCTURE_KEY } from './useRosterStructure';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';

interface AddSubGroupVariables {
    rosterGroupId: string;
    name: string;
    sortOrder?: number;
}

export function useAddSubGroup() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ rosterGroupId, name, sortOrder = 999 }: AddSubGroupVariables) => {
            const { data, error } = await supabase
                .from('roster_subgroups')
                .insert({
                    roster_group_id: rosterGroupId,
                    name: name,
                    sort_order: sortOrder
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            // Invalidate roster structure to refresh the view
            queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
            toast({
                title: "Subgroup Created",
                description: "The new subgroup has been successfully added.",
            });
        },
        onError: (error: any) => {
            console.error('Error adding subgroup:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to add subgroup",
                variant: "destructive"
            });
        }
    });
}

interface AddSubGroupRangeVariables {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    groupExternalId: string;
    name: string;
    startDate: string;
    endDate: string;
}

export function useAddSubGroupRange() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ organizationId, departmentId, subDepartmentId, groupExternalId, name, startDate, endDate }: AddSubGroupRangeVariables) => {
            const { error } = await supabase.rpc('add_roster_subgroup_range', {
                p_org_id: organizationId,
                p_dept_id: departmentId,
                p_sub_dept_id: subDepartmentId,
                p_group_external_id: groupExternalId,
                p_name: name,
                p_start_date: startDate,
                p_end_date: endDate
            });

            if (error) throw error;
            return true;
        },
        onSuccess: (_, variables) => {
            // Invalidate roster structure to refresh the view
            queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
            toast({
                title: "Subgroup Added to Range",
                description: `Added "${variables.name}" to ${variables.startDate} - ${variables.endDate}.`,
            });
        },
        onError: (error: any) => {
            console.error('Error adding subgroup range:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to add subgroup range",
                variant: "destructive"
            });
        }
    });
}

interface ActivateRosterVariables {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string | null;
    startDate: string;
    endDate: string;
}

export function useActivateRoster() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ organizationId, departmentId, subDepartmentId, startDate, endDate }: ActivateRosterVariables) => {
            const { data, error } = await supabase.rpc('activate_roster_for_range', {
                p_org_id: organizationId,
                p_dept_id: departmentId,
                p_sub_dept_id: subDepartmentId,
                p_start_date: startDate,
                p_end_date: endDate
            }) as any;

            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            // Invalidate roster structure and rosters list to refresh the view
            queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
            queryClient.invalidateQueries({ queryKey: [shiftKeys.all] }); // Refresh shifts as rosters are new
            queryClient.invalidateQueries({ queryKey: ['rosters'] }); // Refresh the roster lookup used by the dialog

            const days = data.days_activated || 0;
            const message = days > 0
                ? `Successfully activated rosters for ${days} days.`
                : "Roster is already active for this range.";

            toast({
                title: days > 0 ? "Roster Activated" : "Roster Ready",
                description: message,
            });
        },
        onError: (error: any) => {
            console.error('Error activating roster:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to activate roster",
                variant: "destructive"
            });
        }
    });
}

interface ToggleRosterLockVariables {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string | null;
    startDate: string;
    endDate: string;
    isLocked: boolean;
}

export function useToggleRosterLock() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ organizationId, departmentId, subDepartmentId, startDate, endDate, isLocked }: ToggleRosterLockVariables) => {
            const { error, count } = await supabase.rpc('toggle_roster_lock_for_range', {
                p_org_id: organizationId,
                p_dept_id: departmentId,
                p_sub_dept_id: subDepartmentId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_lock_status: isLocked
            }, { count: 'exact' });

            if (error) throw error;
            return count;
        },
        onSuccess: (_, variables) => {
            // Invalidate rosters list
            queryClient.invalidateQueries({ queryKey: ['rosters'] });

            toast({
                title: variables.isLocked ? "Roster Locked" : "Roster Unlocked",
                description: `Successfully ${variables.isLocked ? 'locked' : 'unlocked'} the roster for the selected range.`,
            });
        },
        onError: (error: any) => {
            console.error('Error toggling roster lock:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to toggle roster lock",
                variant: "destructive"
            });
        }
    });
}

interface PublishRosterVariables {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string | null;
    startDate: string;
    endDate: string;
}

export function usePublishRoster() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ organizationId, departmentId, subDepartmentId, startDate, endDate }: PublishRosterVariables) => {
            const { data, error } = await supabase.rpc('publish_roster_for_range', {
                p_org_id: organizationId,
                p_dept_id: departmentId,
                p_sub_dept_id: subDepartmentId,
                p_start_date: startDate,
                p_end_date: endDate
            }) as any;

            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            // Invalidate rosters and shifts
            queryClient.invalidateQueries({ queryKey: ['rosters'] });
            queryClient.invalidateQueries({ queryKey: [shiftKeys.all] });

            toast({
                title: "Roster Published",
                description: `Published ${data.rosters_published} rosters and ${data.shifts_published} shifts.`,
            });
        },
        onError: (error: any) => {
            console.error('Error publishing roster:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to publish roster",
                variant: "destructive"
            });
        }
    });
}

interface ApplyTemplateVariables {
    templateId: string;
    startDate: string;
    endDate: string;
    userId: string;
    forceStack?: boolean;
    source: 'templates_page' | 'roster_modal';
}

export function useApplyTemplate() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ templateId, startDate, endDate, userId, forceStack = false, source }: ApplyTemplateVariables) => {
            const { data, error } = await supabase.rpc('apply_template_to_date_range_v2', {
                p_template_id: templateId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_user_id: userId,
                p_force_stack: forceStack,
                p_source: source
            } as any) as any;

            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            // Invalidate structure and shifts
            queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
            queryClient.invalidateQueries({ queryKey: [shiftKeys.all] });
            queryClient.invalidateQueries({ queryKey: ['rosters'] }); // Roster records might have been created

            toast({
                title: "Template Applied",
                description: `Appended ${data.shifts_created} shifts across ${data.days_processed} days.`,
            });
        },
        onError: (error: any) => {
            console.error('Error applying template:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to apply template",
                variant: "destructive"
            });
        }
    });
}

export function useClearTemplate() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ rosterId, templateId, userId }: { rosterId: string; templateId: string; userId: string }) => {
            const { data, error } = await (supabase.rpc as any)('sm_clear_template_application', {
                p_roster_id: rosterId,
                p_template_id: templateId,
                p_user_id: userId
            });

            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
            queryClient.invalidateQueries({ queryKey: [shiftKeys.all] });
            queryClient.invalidateQueries({ queryKey: ['rosters'] });

            toast({
                title: "Template Cleared",
                description: `Removed ${data.shifts_deleted} template-derived shifts.`,
            });
        },
        onError: (error: any) => {
            console.error('Clear template error:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to clear template",
                variant: "destructive"
            });
        },
    });
}
