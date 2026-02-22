/**
 * useRosterMutations — Roster-level mutations (structure, publishing, templates)
 *
 * Phase 3 changes:
 *  - Replaced `[shiftKeys.all]` with `shiftKeys.lists` to scope invalidations
 *    correctly (was double-wrapping the key array, never matching anything)
 *  - Added rosterKeys.all for roster-table invalidations
 *  - Added shiftKeys.lookups._root for structure-level invalidations
 *  - Removed (error: any) in favour of `unknown` + narrowing
 *  - Fixed useApplyTemplate toast (data.days_processed doesn't exist in the RPC)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ROSTER_STRUCTURE_KEY } from './useRosterStructure';
import { shiftKeys, rosterKeys } from '@/modules/rosters/api/queryKeys';
import { templateKeys } from '@/modules/templates/hooks/queries/useTemplateQueries';

// ── Helper to extract a user-facing message from any thrown value ─────────────

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

// ── useAddSubGroup ────────────────────────────────────────────────────────────

interface AddSubGroupVariables {
  rosterGroupId: string;
  name:          string;
  sortOrder?:    number;
}

export function useAddSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async ({ rosterGroupId, name, sortOrder = 999 }: AddSubGroupVariables) => {
      const { data, error } = await supabase
        .from('roster_subgroups')
        .insert({ roster_group_id: rosterGroupId, name, sort_order: sortOrder })
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
      toast({ title: 'Subgroup Created', description: 'The new subgroup has been added.' });
    },

    onError: (err) => {
      console.error('[useAddSubGroup]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to add subgroup'), variant: 'destructive' });
    },
  });
}

// ── useAddSubGroupRange ───────────────────────────────────────────────────────

interface AddSubGroupRangeVariables {
  organizationId:  string;
  departmentId:    string;
  subDepartmentId: string;
  groupExternalId: string;
  name:            string;
  startDate:       string;
  endDate:         string;
}

export function useAddSubGroupRange() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async (vars: AddSubGroupRangeVariables) => {
      const { error } = await supabase.rpc('add_roster_subgroup_range', {
        p_org_id:            vars.organizationId,
        p_dept_id:           vars.departmentId,
        p_sub_dept_id:       vars.subDepartmentId,
        p_group_external_id: vars.groupExternalId,
        p_name:              vars.name,
        p_start_date:        vars.startDate,
        p_end_date:          vars.endDate,
      });

      if (error) throw error;
      return true;
    },

    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
      toast({
        title:       'Subgroup Added to Range',
        description: `Added "${vars.name}" to ${vars.startDate} – ${vars.endDate}.`,
      });
    },

    onError: (err) => {
      console.error('[useAddSubGroupRange]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to add subgroup range'), variant: 'destructive' });
    },
  });
}

// ── useActivateRoster ─────────────────────────────────────────────────────────

interface ActivateRosterVariables {
  organizationId:  string;
  departmentId:    string;
  subDepartmentId: string | null;
  startDate:       string;
  endDate:         string;
}

export function useActivateRoster() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async (vars: ActivateRosterVariables): Promise<any> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('activate_roster_for_range', {
        p_org_id:      vars.organizationId,
        p_dept_id:     vars.departmentId,
        p_sub_dept_id: vars.subDepartmentId,
        p_start_date:  vars.startDate,
        p_end_date:    vars.endDate,
      });

      if (error) throw error;
      return data;
    },

    onSuccess: (data) => {
      // Structural change: refresh roster metadata + shift lists
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });

      const days = (data?.days_activated as number | undefined) ?? 0;
      toast({
        title:       days > 0 ? 'Roster Activated' : 'Roster Ready',
        description: days > 0
          ? `Successfully activated rosters for ${days} days.`
          : 'Roster is already active for this range.',
      });
    },

    onError: (err) => {
      console.error('[useActivateRoster]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to activate roster'), variant: 'destructive' });
    },
  });
}

// ── useToggleRosterLock ───────────────────────────────────────────────────────

interface ToggleRosterLockVariables {
  organizationId:  string;
  departmentId:    string;
  subDepartmentId: string | null;
  startDate:       string;
  endDate:         string;
  isLocked:        boolean;
}

export function useToggleRosterLock() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async (vars: ToggleRosterLockVariables) => {
      const { error, count } = await supabase.rpc('toggle_roster_lock_for_range', {
        p_org_id:      vars.organizationId,
        p_dept_id:     vars.departmentId,
        p_sub_dept_id: vars.subDepartmentId,
        p_start_date:  vars.startDate,
        p_end_date:    vars.endDate,
        p_lock_status: vars.isLocked,
      }, { count: 'exact' });

      if (error) throw error;
      return count;
    },

    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
      toast({
        title:       vars.isLocked ? 'Roster Locked' : 'Roster Unlocked',
        description: `Successfully ${vars.isLocked ? 'locked' : 'unlocked'} the roster for the selected range.`,
      });
    },

    onError: (err) => {
      console.error('[useToggleRosterLock]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to toggle roster lock'), variant: 'destructive' });
    },
  });
}

// ── usePublishRoster ──────────────────────────────────────────────────────────

interface PublishRosterVariables {
  organizationId:  string;
  departmentId:    string;
  subDepartmentId: string | null;
  startDate:       string;
  endDate:         string;
}

export function usePublishRoster() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async (vars: PublishRosterVariables): Promise<any> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('publish_roster_for_range', {
        p_org_id:      vars.organizationId,
        p_dept_id:     vars.departmentId,
        p_sub_dept_id: vars.subDepartmentId,
        p_start_date:  vars.startDate,
        p_end_date:    vars.endDate,
      });

      if (error) throw error;
      return data;
    },

    onSuccess: (data) => {
      // Publishing changes lifecycle_status on many shifts — must refresh lists
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });

      const rosters = (data?.rosters_published as number | undefined) ?? 0;
      const shifts  = (data?.shifts_published  as number | undefined) ?? 0;
      toast({
        title:       'Roster Published',
        description: `Published ${rosters} roster${rosters !== 1 ? 's' : ''} and ${shifts} shift${shifts !== 1 ? 's' : ''}.`,
      });
    },

    onError: (err) => {
      console.error('[usePublishRoster]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to publish roster'), variant: 'destructive' });
    },
  });
}

// ── useApplyTemplate ──────────────────────────────────────────────────────────

interface ApplyTemplateVariables {
  templateId:             string;
  startDate:              string;
  endDate:                string;
  userId:                 string;
  source:                 'templates_page' | 'roster_modal';
  targetDepartmentId?:    string;
  targetSubDepartmentId?: string;
}

export function useApplyTemplate() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async (vars: ApplyTemplateVariables): Promise<any> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('apply_template_to_date_range_v2', {
        p_template_id:              vars.templateId,
        p_start_date:               vars.startDate,
        p_end_date:                 vars.endDate,
        p_user_id:                  vars.userId,
        p_source:                   vars.source,
        p_target_department_id:     vars.targetDepartmentId,
        p_target_sub_department_id: vars.targetSubDepartmentId,
      });

      if (error) throw error;
      return data;
    },

    onSuccess: (data, vars) => {
      // Template application creates new rosters + shifts — structural refresh needed
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
      queryClient.invalidateQueries({ queryKey: templateKeys.history(vars.templateId) });

      const shiftsCreated = (data?.shifts_created as number | undefined) ?? 0;
      toast({
        title:       'Template Applied',
        description: `Created ${shiftsCreated} shift${shiftsCreated !== 1 ? 's' : ''} from template.`,
      });
    },

    onError: (err) => {
      console.error('[useApplyTemplate]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to apply template'), variant: 'destructive' });
    },
  });
}

// ── useClearTemplate ──────────────────────────────────────────────────────────

export function useClearTemplate() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async ({ rosterId, templateId, userId }: { rosterId: string; templateId: string; userId: string }): Promise<any> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('sm_clear_template_application', {
        p_roster_id:   rosterId,
        p_template_id: templateId,
        p_user_id:     userId,
      });

      if (error) throw error;
      return data;
    },

    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });

      const deleted = (data?.shifts_deleted as number | undefined) ?? 0;
      toast({
        title:       'Template Cleared',
        description: `Removed ${deleted} template-derived shift${deleted !== 1 ? 's' : ''}.`,
      });
    },

    onError: (err) => {
      console.error('[useClearTemplate]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to clear template'), variant: 'destructive' });
    },
  });
}
