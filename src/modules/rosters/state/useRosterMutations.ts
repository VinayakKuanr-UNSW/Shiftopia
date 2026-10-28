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
import { rostersApi } from '@/modules/rosters/api/rosters.api';
import {
  cloneRosterSubgroup,
  deleteRosterSubgroup,
  renameRosterSubgroup,
  type SubgroupScope,
} from '@/modules/rosters/api/rosterSubgroups.api';
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
   *  `shifts_skipped`. Callers that genuinely need to backfill must opt in.
   *
   *  Sent as the RPC's `p_force_stack`, a misleading name kept only because
   *  renaming a parameter means dropping the function: it has nothing to do with
   *  stacking. A template always adds on top of what is already there. */
  includeStartedShifts?:  boolean;
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
      'paid_break_minutes, break_start, break_end, day_of_week, target_employment_type, target_requires_flexible',
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
 * Which instances this apply will NOT be able to write, and why.
 *
 * PREVIEW, NOT REFUSAL — changed 2026-08-19. This used to throw, cancelling the
 * whole apply over a single offending instance. That was the wrong trade. Every
 * one of the 22 rows in the live template library carries `day_of_week = NULL`,
 * which the RPC reads as EVERY day, so one three-hour shift in a template makes
 * every public holiday and every Sunday in the range a refusal — and a manager
 * who cannot apply a quarter applies three narrower ranges instead. The
 * coverage they wanted on the public holiday then simply does not exist, with
 * no error and no record, and the roster looks finished.
 *
 * `apply_template_to_date_range_v2` now skips those instances itself and
 * reports them, using the same `shift_day_typed_shortfall` predicate that
 * `trg_shift_shape_3_day_typed` enforces. So the authoritative answer comes
 * back WITH the result. This runs first anyway, because a warning a manager
 * sees before committing a quarter of roster is worth one extra round trip —
 * and because it is the only half of the pair that can name the group and
 * subgroup a manager needs in order to go and fix the template.
 *
 * Returns the lines to show rather than throwing. A failure to LOAD still
 * throws: not knowing is not the same as nothing being wrong.
 */
async function previewTemplateApplicationShape(vars: ApplyTemplateVariables): Promise<string[]> {
  const placed = await loadPlacedTemplateShifts(vars.templateId);
  if (placed.length === 0) return [];

  const failures = validateTemplateApplication(placed, vars.startDate, vars.endDate);
  if (failures.length === 0) return [];

  return describeTemplateApplicationFailures(failures);
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
      // mutation, and a check one caller can skip is not a check.
      const shapeWarnings = await previewTemplateApplicationShape(vars);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('apply_template_to_date_range_v2', {
        p_template_id:              vars.templateId,
        p_start_date:               vars.startDate,
        p_end_date:                 vars.endDate,
        p_user_id:                  vars.userId,
        p_source:                   vars.source,
        p_target_department_id:     vars.targetDepartmentId,
        p_target_sub_department_id: vars.targetSubDepartmentId,
        p_force_stack:              vars.includeStartedShifts ?? false,
      });

      if (error) throw error;
      // The client preview travels with the server's answer so `onSuccess` can
      // name the group and subgroup, which the RPC's own report cannot.
      return { ...(data ?? {}), __shapeWarnings: shapeWarnings };
    },

    onSuccess: (data, vars) => {
      // Template application creates new rosters + shifts — structural refresh needed.
      // The summary too: Bucket View, the default, is built from it, not from lists.
      queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
      queryClient.invalidateQueries({ queryKey: shiftKeys.summaries });
      queryClient.invalidateQueries({ queryKey: rosterKeys.all });
      queryClient.invalidateQueries({ queryKey: templateKeys.history(vars.templateId) });

      const shiftsCreated  = (data?.shifts_created as number | undefined) ?? 0;
      const shiftsSkipped  = (data?.shifts_skipped as number | undefined) ?? 0;
      // Counted separately from `shifts_skipped` on purpose: that one means
      // "starts in the past", and the two have opposite remedies — pick a later
      // date versus make the shift longer. One number meaning both would tell a
      // manager to do the wrong thing half the time.
      const shiftsUnlawful = (data?.shifts_skipped_unlawful as number | undefined) ?? 0;
      const warnings       = (data?.__shapeWarnings as string[] | undefined) ?? [];

      if (shiftsUnlawful > 0) {
        // Its own toast, not a clause appended to the success line. These
        // instances are the manager's to fix in the template, and the fix is
        // invisible from the roster they are looking at.
        const shown = warnings.slice(0, 4);
        const rest  = Math.max(0, warnings.length - shown.length);
        toast({
          title: `${shiftsUnlawful} shift${shiftsUnlawful !== 1 ? 's were' : ' was'} not created`,
          description:
            `They would breach the agreement on a public holiday or Sunday, so they were left out ` +
            `and the rest of the range was applied.` +
            (shown.length > 0 ? `\n\n${shown.join('\n')}` : '') +
            (rest > 0 ? `\n…and ${rest} more.` : '') +
            `\n\nLengthen the shift in the template and apply again to fill them.`,
          variant: 'destructive',
        });
      }

      if (shiftsCreated === 0) {
        // "Template Applied — Created 0 shifts" reads as success and explains
        // nothing. Each template shift carries a weekday and
        // apply_template_to_date_range_v2 only creates one on a matching day,
        // so applying a Mon–Fri template to a Saturday is a no-op by design.
        // That is the one cause left for this branch to name: the RPC now
        // reports compliance skips explicitly (handled above) and past-date
        // skips as `shifts_skipped`, so by elimination a zero with neither of
        // those set is a weekday mismatch.
        // Don't repeat the compliance toast above with a weekday explanation
        // that is not the reason — if everything was held back for breaching
        // the agreement, the manager has already been told exactly why.
        if (shiftsUnlawful === 0) {
          toast({
            title: 'No shifts created',
            description:
              'Each template shift is tied to a weekday, and none of them fall on the dates you chose. Check the template covers the days in your range.',
            variant: 'destructive',
          });
        }
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


// ── Sub-group changes: delete / rename / clone ────────────────────────────────
//
// Each acts on ONE group of ONE sub-department's roster, from today to the end
// of the range (days before today are never changed). The dialogs preview with
// the same RPC in dry-run mode first; see api/rosterSubgroups.api.ts.

/** Everything a sub-group change can make stale, including the Bucket View summary. */
function invalidateRosterContent(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [ROSTER_STRUCTURE_KEY] });
  queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
  queryClient.invalidateQueries({ queryKey: shiftKeys.summaries });
  queryClient.invalidateQueries({ queryKey: shiftKeys.lookups._root });
}

export function useDeleteSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: ({ scope, name }: { scope: SubgroupScope; name: string }) =>
      deleteRosterSubgroup(scope, name, false),

    onSuccess: (result, { name }) => {
      invalidateRosterContent(queryClient);
      toast({
        title: result.daysKept > 0 ? `“${name}” partly deleted` : `“${name}” deleted`,
        description:
          `${result.shiftsDeleted} shift${result.shiftsDeleted !== 1 ? 's' : ''} deleted.` +
          (result.shiftsKept > 0 ? ` ${result.shiftsKept} that had already started stay.` : ''),
      });
    },

    onError: (err) => {
      console.error('[useDeleteSubGroup]', err);
      toast({ title: 'Could not delete the subgroup', description: errorMessage(err, 'Failed to delete subgroup'), variant: 'destructive' });
    },
  });
}

export function useRenameSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: ({ scope, oldName, newName }: { scope: SubgroupScope; oldName: string; newName: string }) =>
      renameRosterSubgroup(scope, oldName, newName, false),

    onSuccess: (result, { newName }) => {
      invalidateRosterContent(queryClient);
      toast({
        title: 'Subgroup renamed',
        description: `Now “${newName}” on ${result.days} day${result.days !== 1 ? 's' : ''}.`,
      });
    },

    onError: (err) => {
      console.error('[useRenameSubGroup]', err);
      toast({ title: 'Could not rename the subgroup', description: errorMessage(err, 'Failed to rename subgroup'), variant: 'destructive' });
    },
  });
}

export function useCloneSubGroup() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  return useMutation({
    mutationFn: ({ scope, sourceName, newName }: { scope: SubgroupScope; sourceName: string; newName: string }) =>
      cloneRosterSubgroup(scope, sourceName, newName, false),

    onSuccess: (result, { newName }) => {
      invalidateRosterContent(queryClient);
      toast({
        title: 'Subgroup cloned',
        description: `“${newName}” created with ${result.shiftsCopied} shift${result.shiftsCopied !== 1 ? 's' : ''}.`,
      });
    },

    onError: (err) => {
      console.error('[useCloneSubGroup]', err);
      toast({ title: 'Could not clone the subgroup', description: errorMessage(err, 'Failed to clone subgroup'), variant: 'destructive' });
    },
  });
}
