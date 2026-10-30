/**
 * Roster sub-group and template-application RPCs.
 *
 * Every write here takes `dryRun`. The confirmation dialogs call it with
 * `dryRun: true` and show the counts that come back; the confirm button calls it
 * again with `false`. One code path for both, so the dialog cannot promise
 * something the action then does differently.
 *
 * Shared rules (20261017111129_template_roster_subgroup_integrity):
 *  - one sub-department at a time; the group is part of the address
 *  - days before today are never changed
 *  - shifts that have started or been worked are never deleted or copied
 *  - Office's Administration sub-group is fixed
 */

import { z } from 'zod';
import { callRpc } from '@/platform/supabase/rpc/client';

/** Where a sub-group lives: one group of one sub-department's roster, over a date range. */
export interface SubgroupScope {
  organizationId: string;
  departmentId: string;
  subDepartmentId: string;
  groupExternalId: string;
  startDate: string;
  endDate: string;
}

function scopeParams(scope: SubgroupScope) {
  return {
    p_org_id:            scope.organizationId,
    p_dept_id:           scope.departmentId,
    p_sub_dept_id:       scope.subDepartmentId,
    p_group_external_id: scope.groupExternalId,
    p_start_date:        scope.startDate,
    p_end_date:          scope.endDate,
  };
}

// ── Delete ─────────────────────────────────────────────────────────────────────

const SubgroupDeletionRow = z.object({
  from_date:      z.string(),
  to_date:        z.string(),
  days:           z.number(),
  shifts_deleted: z.number(),
  assigned:       z.number(),
  published:      z.number(),
  shifts_kept:    z.number(),
  days_kept:      z.number(),
  past_days:      z.number(),
  past_shifts:    z.number(),
});

export interface SubgroupDeletion {
  fromDate: string;
  toDate: string;
  /** Days from today on where the sub-group exists. */
  days: number;
  shiftsDeleted: number;
  /** Of the deleted shifts, how many were assigned / published. */
  assigned: number;
  published: number;
  /** Shifts that had started, so stay — and keep their day's sub-group. */
  shiftsKept: number;
  daysKept: number;
  /** Earlier days in the range that have the sub-group; never changed. */
  pastDays: number;
  pastShifts: number;
}

export async function deleteRosterSubgroup(scope: SubgroupScope, name: string, dryRun: boolean): Promise<SubgroupDeletion> {
  const r = await callRpc(
    'delete_roster_subgroup_v2',
    { ...scopeParams(scope), p_name: name, p_dry_run: dryRun },
    SubgroupDeletionRow,
  );
  return {
    fromDate:      r.from_date,
    toDate:        r.to_date,
    days:          r.days,
    shiftsDeleted: r.shifts_deleted,
    assigned:      r.assigned,
    published:     r.published,
    shiftsKept:    r.shifts_kept,
    daysKept:      r.days_kept,
    pastDays:      r.past_days,
    pastShifts:    r.past_shifts,
  };
}

// ── Rename ─────────────────────────────────────────────────────────────────────

const SubgroupRenameRow = z.object({
  from_date: z.string(),
  to_date:   z.string(),
  days:      z.number(),
  shifts:    z.number(),
  past_days: z.number(),
  conflicts: z.array(z.string()),
});

export interface SubgroupRename {
  fromDate: string;
  toDate: string;
  days: number;
  shifts: number;
  pastDays: number;
  /** Days where the group already has a sub-group with the new name. */
  conflicts: string[];
}

export async function renameRosterSubgroup(
  scope: SubgroupScope,
  oldName: string,
  newName: string,
  dryRun: boolean,
): Promise<SubgroupRename> {
  const r = await callRpc(
    'rename_roster_subgroup_v2',
    { ...scopeParams(scope), p_old_name: oldName, p_new_name: newName, p_dry_run: dryRun },
    SubgroupRenameRow,
  );
  return {
    fromDate:  r.from_date,
    toDate:    r.to_date,
    days:      r.days,
    shifts:    r.shifts,
    pastDays:  r.past_days,
    conflicts: r.conflicts,
  };
}

// ── Template application: preview and undo ─────────────────────────────────────

const TemplateApplicationPreviewRow = z.object({
  from_date: z.string(),
  to_date:   z.string(),
  existing_templates: z.array(z.object({
    template_id:      z.string(),
    name:             z.string(),
    shifts:           z.number(),
    first_date:       z.string(),
    last_date:        z.string(),
    is_this_template: z.boolean(),
  })),
  manual_shifts:   z.number(),
  would_create:    z.number(),
  already_applied: z.number(),
  duplicates:      z.number(),
});

export interface TemplateApplicationPreview {
  fromDate: string;
  toDate: string;
  /** Templates whose shifts are already on these days. */
  existingTemplates: Array<{
    templateId: string;
    name: string;
    shifts: number;
    firstDate: string;
    lastDate: string;
    isThisTemplate: boolean;
  }>;
  /** Shifts on these days that came from no template. */
  manualShifts: number;
  /** Instances the apply would create (before its past / day-typed skips). */
  wouldCreate: number;
  /** Instances already there from an earlier apply of the same template; skipped. */
  alreadyApplied: number;
  /** New instances identical to a shift already there (sub-group, times, role). */
  duplicates: number;
}

export async function previewTemplateApplication(params: {
  templateId: string;
  startDate: string;
  endDate: string;
  targetDepartmentId?: string;
  targetSubDepartmentId?: string;
}): Promise<TemplateApplicationPreview> {
  const r = await callRpc(
    'preview_template_application',
    {
      p_template_id:              params.templateId,
      p_start_date:               params.startDate,
      p_end_date:                 params.endDate,
      p_target_department_id:     params.targetDepartmentId ?? null,
      p_target_sub_department_id: params.targetSubDepartmentId ?? null,
    },
    TemplateApplicationPreviewRow,
  );
  return {
    fromDate: r.from_date,
    toDate:   r.to_date,
    existingTemplates: r.existing_templates.map(t => ({
      templateId:     t.template_id,
      name:           t.name,
      shifts:         t.shifts,
      firstDate:      t.first_date,
      lastDate:       t.last_date,
      isThisTemplate: t.is_this_template,
    })),
    manualShifts:   r.manual_shifts,
    wouldCreate:    r.would_create,
    alreadyApplied: r.already_applied,
    duplicates:     r.duplicates,
  };
}

const TemplateUndoRow = z.union([
  z.object({ success: z.literal(false), message: z.string() }),
  z.object({
    success:        z.literal(true),
    batch_id:       z.string(),
    template_id:    z.string(),
    start_date:     z.string(),
    end_date:       z.string(),
    shifts_deleted: z.number(),
    assigned:       z.number(),
    published:      z.number(),
    shifts_kept:    z.number(),
  }),
]);

export interface TemplateUndo {
  batchId: string;
  templateId: string;
  startDate: string;
  endDate: string;
  shiftsDeleted: number;
  assigned: number;
  published: number;
  /** Shifts that had started, so stay. */
  shiftsKept: number;
}

/** Throws when the application no longer exists (someone else undid it). */
export async function undoTemplateApplication(batchId: string, userId: string, dryRun: boolean): Promise<TemplateUndo> {
  const r = await callRpc(
    'undo_template_batch',
    { p_batch_id: batchId, p_user_id: userId, p_dry_run: dryRun },
    TemplateUndoRow,
  );
  if (!r.success) throw new Error(r.message);
  return {
    batchId:       r.batch_id,
    templateId:    r.template_id,
    startDate:     r.start_date,
    endDate:       r.end_date,
    shiftsDeleted: r.shifts_deleted,
    assigned:      r.assigned,
    published:     r.published,
    shiftsKept:    r.shifts_kept,
  };
}
