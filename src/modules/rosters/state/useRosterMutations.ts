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
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import { ROSTER_STRUCTURE_KEY } from './useRosterStructure';
import { shiftKeys, rosterKeys } from '@/modules/rosters/api/queryKeys';
import { templateKeys } from '@/modules/templates/hooks/queries/useTemplateQueries';
import { fairnessLedgerService } from '@/modules/rosters/services/fairnessLedger.service';
import { rostersApi } from '@/modules/rosters/api/rosters.api';
import {
  validateTemplateApplication,
  describeTemplateApplicationFailures,
  templateShiftFromRow,
  type PlacedTemplateShift,
  type TemplateShiftRow,
} from '@/modules/templates/model/templateShape';

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
  subDepartmentId: string | null;
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
        p_sub_dept_id:       vars.subDepartmentId || null,
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

// NOTE: `useActivateRoster` (and the ActivateRosterDialog that never had a mount
// point) were removed on 2026-08-05. Roster activation is implicit — the day
// container is created on first write by sm_resolve_roster, called from
// sm_create_shift, apply_template_to_date_range_v2 and sm_move_shift. The
// underlying `activate_roster_for_range` RPC is left in place but has no callers.
//
// `useCreatePlanningPeriod` went the same way. It wrote a `planning_periods` row
// that no screen in the application ever read — the only consumer was the dialog
// that created it, checking for its own duplicates (5 rows against 193 rosters in
// prod). Its two real jobs are now explicit: `useEnsureRosters` below creates the
// day containers, and `useApplyTemplate` seeds the shifts. The RPC and the table
// are left in place so the 99 rosters already linked to a period keep their
// reference; nothing writes them any more.

// ── useEnsureRosters ──────────────────────────────────────────────────────────

interface EnsureRostersVariables {
  organizationId:   string;
  departmentId:     string;
  /** May contain `null` — a department-level roster, not "unset". */
  subDepartmentIds: (string | null)[];
  startDate:        string;
  endDate:          string;
}

export function useEnsureRosters() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: (vars: EnsureRostersVariables) =>
      rostersApi.ensureRostersForRange(vars),

    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });

      // Report what actually happened, including the days deliberately not
      // touched — a range starting in the past silently does less than the user
      // asked for unless we say so.
      const parts = [`${data.days_created} day${data.days_created !== 1 ? 's' : ''} prepared`];
      if (data.days_existing > 0) parts.push(`${data.days_existing} already existed`);
      if (data.days_skipped  > 0) parts.push(`${data.days_skipped} past day${data.days_skipped !== 1 ? 's' : ''} skipped`);

      toast({ title: 'Days Prepared', description: `${parts.join(' · ')}.` });
    },

    onError: (err) => {
      console.error('[useEnsureRosters]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to prepare roster days'), variant: 'destructive' });
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
        p_org_id:      vars.organizationId as string,
        p_dept_id:     vars.departmentId as string,
        p_sub_dept_id: vars.subDepartmentId as string,
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

    onSuccess: (data, vars) => {
      // Publishing changes lifecycle_status on many shifts — must refresh lists
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });

      // F1 fairness-ledger refresh. Publishing is the natural cadence at which
      // assignments become authoritative, so rebuild the rolling-window ledger
      // for this org against today's window_end. This keeps debts fresh without
      // a separate cron: the incremental updateAfterCommit handles the solver's
      // own commits, and this covers manual edits + the daily window roll-forward
      // (getEmployeeDebts reads `window_end = today`, which only exists once a
      // recompute has run for today). Org-wide (no dept filter) so the team
      // average matches the org-wide read path. Fire-and-forget: a ledger hiccup
      // must never surface as a publish failure.
      if (vars?.organizationId) {
        fairnessLedgerService
          .recomputeLedger(vars.organizationId, new Date())
          .catch(err =>
            console.error('[usePublishRoster] Fairness ledger recompute failed:', err),
          );
      }

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
  /** When true, bypasses the "shift already started" temporal guard so managers can
   *  re-apply templates to today or past dates without an exception. The per-shift
   *  template_instance_id duplicate check still prevents actual duplicates.
   *
   *  Defaults to FALSE. It previously defaulted to true, which meant every template
   *  apply from the roster modal silently created shifts in the past — directly
   *  against the rule that shifts are never created, edited or updated in the past
   *  (decision 2026-08-05). Past shifts are now soft-skipped and reported through
   *  `shifts_skipped`. Callers that genuinely need to backfill must opt in. */
  forceStack?:            boolean;
}

/**
 * Load a stored template's shifts, with the group/subgroup names a failure
 * needs to be findable.
 *
 * Three plain queries rather than one nested PostgREST select: an embedded
 * resource that cannot be resolved fails the WHOLE request, and a failure here
 * must never be mistaken for "this template has no shifts", which would turn
 * the gate below into a silent pass.
 */
async function loadPlacedTemplateShifts(templateId: string): Promise<PlacedTemplateShift[]> {
  const { data: groups, error: gErr } = await supabase
    .from('template_groups')
    .select('id, name')
    .eq('template_id', templateId);
  if (gErr) throw gErr;
  if (!groups || groups.length === 0) return [];

  const { data: subGroups, error: sgErr } = await supabase
    .from('template_subgroups')
    .select('id, name, group_id')
    .in('group_id', groups.map(g => g.id));
  if (sgErr) throw sgErr;
  if (!subGroups || subGroups.length === 0) return [];

  const { data: rows, error: sErr } = await supabase
    .from('template_shifts')
    .select(
      'id, name, role_name, start_time, end_time, unpaid_break_minutes, ' +
      'paid_break_minutes, day_of_week, target_employment_type, target_requires_flexible',
    )
    .in('subgroup_id', subGroups.map(sg => sg.id));
  if (sErr) throw sErr;

  const groupName = new Map(groups.map(g => [g.id as string, g.name as string]));
  const subGroupById = new Map(subGroups.map(sg => [sg.id as string, sg]));

  return ((rows ?? []) as unknown as Array<TemplateShiftRow & { subgroup_id: string }>).map(row => {
    const sg = subGroupById.get(row.subgroup_id);
    return {
      groupName:    (sg && groupName.get(sg.group_id as string)) || 'Template',
      subGroupName: (sg?.name as string) || '',
      shift:        templateShiftFromRow(row),
    };
  });
}

/**
 * Refuse an apply that would stamp an unlawful shift onto a special day.
 *
 * Throws with every offending date rather than the first: a manager who has to
 * discover a fortnight's worth of breaches one apply at a time will reach for
 * a narrower date range instead of fixing the template.
 */
async function assertTemplateApplicationShape(vars: ApplyTemplateVariables): Promise<void> {
  const placed = await loadPlacedTemplateShifts(vars.templateId);
  if (placed.length === 0) return;

  const failures = validateTemplateApplication(placed, vars.startDate, vars.endDate);
  if (failures.length === 0) return;

  const lines = describeTemplateApplicationFailures(failures);
  const shown = lines.slice(0, 5);
  const rest = lines.length - shown.length;
  throw new Error(
    `This template cannot be applied to the dates you chose — ${failures.length} shift` +
    `${failures.length !== 1 ? 's' : ''} would breach the agreement on a public holiday or ` +
    `Sunday:\n\n${shown.join('\n')}` +
    (rest > 0 ? `\n…and ${rest} more.` : '') +
    `\n\nEither shorten the date range or fix the template.`,
  );
}

export function useApplyTemplate() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async (vars: ApplyTemplateVariables): Promise<any> => {
      // ── Layer 1, application half ──────────────────────────────────────────
      //
      // The authoring gate clears everything intrinsic to a template shift, but
      // two shape rules need a DATE and a template has at most a day-of-week:
      // cl 56.2's four-hour public-holiday minimum, and the Sunday tier of
      // cl 12.4(c)/12.5(c) reached by a shift whose day-of-week is "any".
      // Applying a lawful template across Christmas could still mint a
      // three-hour casual shift the agreement says must be four.
      //
      // Runs here rather than in the dialogs because both of them call this
      // mutation, and a gate one caller can skip is not a gate.
      await assertTemplateApplicationShape(vars);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('apply_template_to_date_range_v2', {
        p_template_id:              vars.templateId,
        p_start_date:               vars.startDate,
        p_end_date:                 vars.endDate,
        p_user_id:                  vars.userId,
        p_source:                   vars.source,
        p_target_department_id:     vars.targetDepartmentId,
        p_target_sub_department_id: vars.targetSubDepartmentId,
        p_force_stack:              vars.forceStack ?? false,
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
      const shiftsSkipped = (data?.shifts_skipped as number | undefined) ?? 0;

      if (shiftsCreated === 0) {
        // "Template Applied — Created 0 shifts" reads as success and explains
        // nothing. Each template shift carries a weekday and
        // apply_template_to_date_range_v2 only creates one on a matching day,
        // so applying a Mon–Fri template to a Saturday is a no-op by design.
        // The RPC does not report which rule rejected what, so this names the
        // rule behind nearly every case rather than asserting a cause it
        // cannot know.
        toast({
          title: 'No shifts created',
          description:
            'Each template shift is tied to a weekday, and none of them fall on the dates you chose. Check the template covers the days in your range.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title:       'Template Applied',
        description: `Created ${shiftsCreated} shift${shiftsCreated !== 1 ? 's' : ''}${shiftsSkipped > 0 ? ` (${shiftsSkipped} past shifts skipped)` : ''}.`,
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

// ── useDeleteSubGroup ─────────────────────────────────────────────────────────

export function useDeleteSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async ({
      orgId,
      deptId,
      groupExternalId,
      name,
      startDate,
      endDate
    }: {
      orgId: string;
      deptId: string;
      groupExternalId: string;
      name: string;
      startDate: string;
      endDate: string;
    }) => {
      const { error } = await supabase.rpc('delete_roster_subgroup_v2', {
        p_org_id: orgId,
        p_dept_id: deptId,
        p_group_external_id: groupExternalId,
        p_name: name,
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (error) throw error;
      return true;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
      toast({ title: 'Subgroup Deleted', description: 'The subgroup and its shifts have been removed across the active range.' });
    },

    onError: (err) => {
      console.error('[useDeleteSubGroup]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to delete subgroup'), variant: 'destructive' });
    },
  });
}

// ── useRenameSubGroup ─────────────────────────────────────────────────────────

export function useRenameSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async ({
      orgId,
      deptId,
      groupExternalId,
      oldName,
      newName,
      startDate,
      endDate
    }: {
      orgId: string;
      deptId: string;
      groupExternalId: string;
      oldName: string;
      newName: string;
      startDate: string;
      endDate: string;
    }) => {
      const { error } = await supabase.rpc('rename_roster_subgroup_v2', {
        p_org_id: orgId,
        p_dept_id: deptId,
        p_group_external_id: groupExternalId,
        p_old_name: oldName,
        p_new_name: newName,
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (error) throw error;
      return true;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
      toast({ title: 'Subgroup Renamed', description: 'The subgroup has been renamed across the active range.' });
    },

    onError: (err) => {
      console.error('[useRenameSubGroup]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to rename subgroup'), variant: 'destructive' });
    },
  });
}

// ── useCloneSubGroup ──────────────────────────────────────────────────────────

export function useCloneSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: async ({
      orgId,
      deptId,
      groupExternalId,
      sourceName,
      newName,
      startDate,
      endDate
    }: {
      orgId: string;
      deptId: string;
      groupExternalId: string;
      sourceName: string;
      newName: string;
      startDate: string;
      endDate: string;
    }) => {
      const { data, error } = await supabase.rpc('clone_roster_subgroup_v2', {
        p_org_id: orgId,
        p_dept_id: deptId,
        p_group_external_id: groupExternalId,
        p_source_name: sourceName,
        p_new_name: newName,
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (error) throw error;
      return data;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
      toast({ title: 'Subgroup Cloned', description: 'The subgroup and its shifts have been duplicated across the active range.' });
    },

    onError: (err) => {
      console.error('[useCloneSubGroup]', err);
      toast({ title: 'Error', description: errorMessage(err, 'Failed to clone subgroup'), variant: 'destructive' });
    },
  });
}
