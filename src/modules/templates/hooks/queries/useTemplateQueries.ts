// src/modules/templates/hooks/queries/useTemplateQueries.ts
// React Query hooks for Templates module
// This file provides the data layer for all template operations

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/platform/supabase/client';
import {
    Template,
    TemplateBatch,
    dbTemplateToFrontend,
} from '../../model/templates.types';
import { undoTemplateApplication } from '@/modules/rosters/api/rosterSubgroups.api';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { ROSTER_STRUCTURE_KEY } from '@/modules/rosters/state/useRosterStructure';

/* ============================================================
   QUERY KEYS
   ============================================================ */

export const templateKeys = {
    all: ['templates'] as const,
    lists: () => [...templateKeys.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) => [...templateKeys.lists(), filters] as const,
    details: () => [...templateKeys.all, 'detail'] as const,
    detail: (id: string) => [...templateKeys.details(), id] as const,
    histories: () => [...templateKeys.all, 'history'] as const,
    history: (id: string) => [...templateKeys.histories(), id] as const,
};

/* ============================================================
   QUERIES
   ============================================================ */

/**
 * Fetch all templates from the v_template_full view.
 * This view aggregates groups, subgroups, and shifts into JSON.
 */
export function useAllTemplates() {
    return useQuery({
        queryKey: templateKeys.lists(),
        queryFn: async (): Promise<Template[]> => {
            const { data, error } = await supabase
                .from('v_template_full')
                .select('*')
                .order('updated_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(dbTemplateToFrontend);
        },
        staleTime: 30_000, // 30 seconds
    });
}


/**
 * Fetch application history for a specific template.
 */
export function useTemplateHistory(id?: string) {
    return useQuery({
        queryKey: templateKeys.history(id || ''),
        queryFn: async (): Promise<TemplateBatch[]> => {
            if (!id) return [];

            const { data, error } = await supabase
                .from('roster_template_batches')
                .select(`
                    id,
                    template_id,
                    start_date,
                    end_date,
                    source,
                    applied_by,
                    applied_at,
                    profiles:applied_by (
                        first_name,
                        last_name
                    )
                `)
                .eq('template_id', id)
                .order('applied_at', { ascending: false });

            if (error) throw error;

            return (data || []).map((db: any): TemplateBatch => ({
                id: db.id,
                templateId: db.template_id,
                startDate: db.start_date,
                endDate: db.end_date,
                source: db.source,
                appliedBy: db.applied_by,
                appliedByName: db.profiles
                    ? `${db.profiles.first_name || ''} ${db.profiles.last_name || ''}`.trim()
                    : undefined,
                appliedAt: db.applied_at,
            }));
        },
        enabled: !!id,
    });
}

/* ============================================================
   MUTATIONS
   ============================================================ */






/**
 * Undo a specific template batch application.
 */
export function useUndoTemplateBatch() {
    const queryClient = useQueryClient();

    return useMutation({
        // Removes only the shifts this application created that have not started;
        // the confirmation previews the same call with dryRun (RosterTemplatesDialog).
        mutationFn: async ({ batchId }: { batchId: string }) => {
            const { data: auth } = await supabase.auth.getUser();
            if (!auth?.user) throw new Error('Not authenticated');
            return undoTemplateApplication(batchId, auth.user.id, false);
        },
        onSuccess: async (result) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: templateKeys.all }),
                queryClient.invalidateQueries({ queryKey: templateKeys.history(result.templateId) }),
                // The shifts left the roster, so the roster views must refetch too.
                queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.lists }),
                queryClient.invalidateQueries({ queryKey: shiftKeys.summaries }),
            ]);
            toast.success(
                `Removed ${result.shiftsDeleted} shift${result.shiftsDeleted !== 1 ? 's' : ''}` +
                (result.shiftsKept > 0 ? `; ${result.shiftsKept} that had already started stay.` : '.'),
            );
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to undo application');
        },
    });
}
