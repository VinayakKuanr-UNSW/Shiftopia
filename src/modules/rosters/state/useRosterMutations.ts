import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ROSTER_STRUCTURE_KEY } from './useRosterStructure';

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
    groupExternalId: string;
    name: string;
    startDate: string;
    endDate: string;
}

export function useAddSubGroupRange() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: async ({ organizationId, groupExternalId, name, startDate, endDate }: AddSubGroupRangeVariables) => {
            const { error } = await supabase.rpc('add_roster_subgroup_range', {
                p_org_id: organizationId,
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
