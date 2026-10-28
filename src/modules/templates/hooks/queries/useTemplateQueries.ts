// src/modules/templates/hooks/queries/useTemplateQueries.ts
// React Query hooks for Templates module
// This file provides the data layer for all template operations

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/platform/supabase/client';
import { assertWrote } from '@/platform/supabase/writes';
import {
    Template,
    TemplateBatch,
    Group,
    CreateTemplateInput,
    SaveTemplateResult,
    VersionCheckResult,
    NameValidationResult,
    dbTemplateToFrontend,
    frontendToDbGroups,
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
 * Fetch a single template by ID.
 */
function useTemplateById(id?: string) {
    return useQuery({
        queryKey: templateKeys.detail(id || ''),
        queryFn: async (): Promise<Template | null> => {
            if (!id) return null;

            const { data, error } = await supabase
                .from('v_template_full')
                .select('*')
                .eq('id', id)
                .single();

            if (error) {
                if (error.code === 'PGRST116') return null; // Not found
                throw error;
            }

            return dbTemplateToFrontend(data);
        },
        enabled: !!id,
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
 * Create a new template.
 * Note: Default groups are seeded by database trigger.
 */
function useCreateTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: CreateTemplateInput): Promise<Template> => {
            const { data: auth } = await supabase.auth.getUser();
            if (!auth?.user) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('roster_templates')
                .insert({
                    name: input.name,
                    description: input.description || null,
                    organization_id: input.organizationId,
                    department_id: input.departmentId,
                    sub_department_id: input.subDepartmentId,
                    published_month: input.month || null,
                    status: 'draft',
                    created_by: auth.user.id,
                    last_edited_by: auth.user.id,
                    version: 1,
                })
                .select()
                .single();

            if (error) throw error;

            // Fetch full template with groups (seeded by trigger)
            const { data: fullData, error: fetchError } = await supabase
                .from('v_template_full')
                .select('*')
                .eq('id', data.id)
                .single();

            if (fetchError) throw fetchError;
            return dbTemplateToFrontend(fullData);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: templateKeys.all });
            toast.success('Template created successfully');
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create template');
        },
    });
}

/**
 * Save template changes using the atomic RPC function.
 * CRITICAL: This is the only valid way to update template data.
 */
function useSaveTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            templateId,
            expectedVersion,
            name,
            description,
            groups,
        }: {
            templateId: string;
            expectedVersion: number;
            name: string;
            description?: string;
            groups: Group[];
        }): Promise<{ success: boolean; newVersion: number }> => {
            const { data: auth } = await supabase.auth.getUser();
            if (!auth?.user) throw new Error('Not authenticated');

            const groupsJson = frontendToDbGroups(groups);

            const { data, error } = await supabase.rpc('save_template_full', {
                p_template_id: templateId,
                p_expected_version: expectedVersion,
                p_name: name,
                p_description: description || '',
                p_groups: groupsJson,
                p_user_id: auth.user.id,
            });

            if (error) throw error;

            const result = data as SaveTemplateResult[] | null;
            if (!result || result.length === 0) {
                throw new Error('No response from save operation');
            }

            const saveResult = result[0];
            if (!saveResult.success) {
                throw new Error(saveResult.error_message || 'Save failed');
            }

            return {
                success: true,
                newVersion: saveResult.new_version || expectedVersion + 1,
            };
        },
        onSuccess: async (_, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: templateKeys.detail(variables.templateId) }),
                queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
            ]);
            toast.success('Template saved');
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to save template');
        },
    });
}

/**
 * Delete a template.
 */
function useDeleteTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            // First cascade delete child shifts
            await (supabase.rpc as any)('delete_template_shifts_cascade', { p_template_id: id });

            // Then delete the template
            const deleted = await supabase
                .from('roster_templates')
                .delete({ count: 'exact' })
                .eq('id', id);

            if (deleted.error) throw deleted.error;
            assertWrote(deleted, 'delete this template');
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: templateKeys.all });
            toast.success('Template deleted');
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to delete template');
        },
    });
}

/**
 * Publish a template to a date range.
 */
function usePublishTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            templateId,
            startDate,
            endDate,
            forceOverride = false,
        }: {
            templateId: string;
            startDate: string;
            endDate: string;
            forceOverride?: boolean;
        }) => {
            const { data: auth } = await supabase.auth.getUser();
            if (!auth?.user) throw new Error('Not authenticated');

            const { data, error } = await supabase.rpc('publish_template_range', {
                p_template_id: templateId,
                p_start_date: startDate,
                p_end_date: endDate,
                p_user_id: auth.user.id,
                p_force_override: forceOverride,
            });

            if (error) throw error;

            if (!data) {
                throw new Error('No response from publish operation');
            }

            // RPC returns an array, access first element
            const result = (Array.isArray(data) ? data[0] : data) as any;

            if (!result?.success) {
                throw new Error(result?.error_message || 'Publish failed');
            }

            return result;
        },
        onSuccess: async (_, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: templateKeys.detail(variables.templateId) }),
                queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
            ]);
            toast.success('Template published successfully');
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to publish template');
        },
    });
}

/**
 * Validate template name uniqueness.
 */
function useValidateTemplateName() {
    return useMutation({
        mutationFn: async ({
            organizationId,
            subDepartmentId,
            name,
            excludeId,
        }: {
            organizationId: string;
            subDepartmentId: string;
            name: string;
            excludeId?: string;
        }): Promise<NameValidationResult> => {
            const { data, error } = await supabase.rpc('validate_template_name', {
                p_organization_id: organizationId,
                p_sub_department_id: subDepartmentId,
                p_name: name,
                p_exclude_id: excludeId || null,
            } as any);

            if (error) throw error;

            const result = data as NameValidationResult[] | null;
            if (!result || result.length === 0) {
                return { is_valid: true, error_message: null };
            }

            return result[0];
        },
    });
}

/**
 * Check version conflict before saving.
 */
function useCheckVersion() {
    return useMutation({
        mutationFn: async ({
            templateId,
            expectedVersion,
        }: {
            templateId: string;
            expectedVersion: number;
        }): Promise<VersionCheckResult | null> => {
            const { data, error } = await supabase.rpc('check_template_version', {
                p_template_id: templateId,
                p_expected_version: expectedVersion,
            });

            if (error) throw error;

            const result = data as VersionCheckResult[] | null;
            if (!result || result.length === 0) return null;

            return result[0];
        },
    });
}
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
