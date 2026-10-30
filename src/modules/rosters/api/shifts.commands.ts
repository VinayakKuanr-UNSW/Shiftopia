import { supabase } from '@/platform/supabase/client';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { processInChunks, EMERGENT_WINDOW_MS, DEFAULT_CHUNK_CONCURRENCY } from '../domain/bulk-action-engine';
import { Shift, isValidUuid, safeUuid, calculateMinutesBetweenTimes } from '../domain/shift.entity';
import { CreateShiftData, UpdateShiftData } from './shifts.dto';
import { complianceService } from '../services/compliance.service';
import { callRpc, callAuthenticatedRpc, requireUser } from '@/platform/supabase/rpc/client';
import { shiftsQueries, type PublishCheckRow } from './shifts.queries';
import { ComplianceError, ComplianceUnavailableError } from '@/platform/supabase/rpc/errors';
import { assertShapeForRow, assertShapeForShiftId } from './shift-shape-gate';
import {
    CreateShiftResponseSchema,
    PublishShiftResponseSchema,
    BulkPublishResponseSchema,
    BulkAssignAtomicResponse,
    BulkAssignAtomicResponseSchema,
    BulkDeleteResponseSchema,
    DeleteShiftResponseSchema,
    OfferActionResponseSchema,
    EmployeeDropResponseSchema,
    ApplyShiftOpResponseSchema,
} from './contracts';

/** Publish refuses a shift the compliance engine never answered for. */
const COMPLIANCE_NOT_CHECKED =
    'Compliance engine unreachable — this shift could not be checked, so it was not published. Try again.';

/** Mirrors sm_publish_shift's FT_UNASSIGNED refusal. */
const FT_UNASSIGNED =
    'A full-time shift must be assigned before it is published — it can never go to bidding.';

/** A shift edited or reassigned between its compliance check and the publish write. */
const CHANGED_SINCE_CHECK =
    'This shift changed after it was checked (someone else edited or reassigned it). Reload and try again.';

/** Lifecycle states a shift can only be in once it has been published. */
const POST_PUBLISH_STATUSES = new Set(['Published', 'InProgress', 'Completed']);

/**
 * Which of `ids` the database now holds as published; throws if the read fails.
 * 100 ids per GET (HTTP 414 above that), 6 GETs in flight (connection pool).
 */
async function readPublishedIds(ids: string[]): Promise<Set<string>> {
    const ID_BATCH_SIZE = 100;
    const BATCH_CONCURRENCY = 6;
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
        batches.push(ids.slice(i, i + ID_BATCH_SIZE));
    }

    const published = new Set<string>();
    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
        const results = await Promise.all(
            batches.slice(i, i + BATCH_CONCURRENCY).map(batch =>
                supabase.from('shifts').select('id, lifecycle_status').in('id', batch),
            ),
        );
        for (const res of results) {
            if (res.error) throw new Error(res.error.message);
            for (const row of (res.data ?? []) as Array<{ id: string; lifecycle_status: string }>) {
                if (POST_PUBLISH_STATUSES.has(row.lifecycle_status)) published.add(row.id);
            }
        }
    }
    return published;
}

/** Why the gateway refused an emergency publish, in words a manager can act on. */
function emergencyPublishRefusal(envelope: {
    code: string; note?: string | null; details?: string | null; error?: string | null; current_state?: string | null;
}): string {
    switch (envelope.code) {
        case 'VERSION_CONFLICT':
            return CHANGED_SINCE_CHECK;
        case 'ILLEGAL_TRANSITION':
            return `Publishing is not allowed in the shift's current state (${envelope.current_state ?? 'unknown'}).`;
        case 'FORBIDDEN':
            return 'You do not have permission to publish this shift.';
        case 'GONE':
            return 'Shift not found or has been deleted.';
        case 'WRITE_REJECTED':
            return `Emergency publish was rejected: ${envelope.details ?? envelope.note ?? 'unknown reason'}`;
        default:
            return envelope.note ?? envelope.error ?? envelope.code;
    }
}

/** Why a shift failed its compliance check: the rules it broke, or that it was never checked. */
function complianceFailureReason(v: { status: string; violations: string[] }): string {
    if (v.violations.length > 0) return v.violations.join(', ');
    return v.status === 'unavailable' ? COMPLIANCE_NOT_CHECKED : 'Failed a compliance check (no rule was named).';
}

// ============================================================
// BULK ACTION PARTIAL RESULT TYPES
// ============================================================

/** Publish — compliance checked per-shift, partial success supported. */
type BulkPublishPartialResult = {
    /** IDs that were fully published in the DB */
    publishedIds: string[];
    /** IDs that failed the client-side compliance pre-check */
    complianceFailed: Array<{ id: string; reason: string }>;
    /** IDs that passed compliance but failed in the DB RPC */
    dbFailed: Array<{ id: string; reason: string }>;
};

/** Unpublish — per-shift via processInChunks, partial success supported. */
type BulkUnpublishPartialResult = {
    unpublishedIds: string[];
    failed: Array<{ id: string; reason: string }>;
};

/** Delete — per-item via processInChunks, partial success supported. */
type BulkDeletePartialResult = {
    deletedIds: string[];
    failed: Array<{ id: string; reason: string }>;
};

/**
 * Publish validation result — returned by validateBulkPublishCompliance.
 * Mirrors the shape expected by BulkActionsToolbar's onValidatePublish prop.
 */
type BulkPublishValidationResult = {
    eligible: string[];
    complianceFailed: Array<{ id: string; reason: string }>;
    skipped: Array<{ id: string; reason: string }>;
};

export const shiftsCommands = {
    /* ============================================================
       MOVE SHIFT (DnD position change)
       Uses dedicated sm_move_shift RPC to bypass the broken
       notify_user trigger on the shifts table.
       ============================================================ */

    async moveShift(shiftId: string, params: {
        groupType?: string | null;
        subGroupName?: string | null;
        shiftGroupId?: string | null;
        rosterSubgroupId?: string | null;
        shiftDate?: string | null;
    }): Promise<{ success: boolean; error?: string }> {
        const user = await requireUser();

        // ── Layer 1: shape of the shift AFTER the move ────────────────────────
        //
        // A move that changes only the group or subgroup cannot change a shape
        // verdict — nothing in Layer 1 reads either. A move that changes the
        // DATE can change two: cl 56.2's four-hour public-holiday minimum, and
        // the Sunday tier of cl 12.4(c)/12.5(c). Dragging a lawful three-hour
        // Monday casual onto Christmas Day made it unlawful, and this path
        // never asked, because it calls `sm_move_shift` directly rather than
        // going through `updateShift` where the create/edit gate lives.
        //
        // Gated by id rather than by row: the caller holds a destination date
        // and nothing else, and the question a re-date raises — "is this shift
        // long enough for THAT day" — cannot be answered from the patch alone.
        if (params.shiftDate) {
            await assertShapeForShiftId(
                shiftId,
                { shift_date: params.shiftDate },
                { rpcName: 'sm_move_shift' },
            );
        }

        const { data, error } = await supabase.rpc('sm_move_shift', {
            p_shift_id: shiftId,
            p_group_type: params.groupType ?? undefined,
            p_sub_group_name: params.subGroupName ?? undefined,
            p_shift_group_id: safeUuid(params.shiftGroupId) ?? undefined,
            p_roster_subgroup_id: safeUuid(params.rosterSubgroupId) ?? undefined,
            p_shift_date: params.shiftDate ?? undefined,
            p_user_id: user.id,
        });

        if (error) {
            throw new Error(error.message);
        }

        const result = data as { success: boolean; error?: string };
        if (!result.success) {
            throw new Error(result.error ?? 'Failed to move shift');
        }

        return result;
    },

    /* ============================================================
       CREATE SHIFT
       ============================================================ */

    async createShift(shiftData: CreateShiftData): Promise<Shift> {
        const user = await requireUser();

        // ── Layer 1: shift shape ──────────────────────────────────────────────
        // Runs on EVERY creation, assigned or not, because a shift's shape is
        // wrong before anyone is put in it. This is the only enforcement point:
        // the shape layer used to be reachable solely through the Add Shift
        // modal, so the DnD quick-add, Group Mode inline create, the Labor
        // Demand page and the synthesiser all wrote unchecked rows. There is no
        // bypass: the table's CHECK constraints refuse what this refuses.
        await assertShapeForRow(
            {
                shift_date:               shiftData.shift_date,
                start_time:               shiftData.start_time,
                end_time:                 shiftData.end_time,
                unpaid_break_minutes:     shiftData.unpaid_break_minutes,
                paid_break_minutes:       shiftData.paid_break_minutes,
                break_start:              shiftData.break_start,
                break_end:                shiftData.break_end,
                is_training:              shiftData.is_training,
                target_employment_type:   shiftData.target_employment_type,
                target_requires_flexible: shiftData.target_requires_flexible,
                role_id:                  shiftData.role_id,
            },
            { rpcName: 'sm_create_shift' },
        );

        // ── Layer 2: labour compliance ────────────────────────────────────────
        // Person-scoped, so it only runs once there is a person.
        if (shiftData.assigned_employee_id && isValidUuid(shiftData.assigned_employee_id)) {
            const netMinutes =
                calculateMinutesBetweenTimes(shiftData.start_time, shiftData.end_time)
                - (shiftData.unpaid_break_minutes || 0);

            const validation = await complianceService.validateShiftCompliance(
                shiftData.assigned_employee_id,
                shiftData.shift_date,
                shiftData.start_time,
                shiftData.end_time,
                netMinutes
            );

            // An unreachable engine is not a pass: the local fallback sees only
            // past dates and start=end, so saving on it would roster someone
            // nobody checked. Say it was never checked, not that it failed a rule.
            if (!validation.engineReached || validation.status === 'unavailable') {
                throw new ComplianceUnavailableError(undefined, 'sm_create_shift');
            }
            if (!validation.isValid) {
                throw new ComplianceError(validation.violations, 'sm_create_shift');
            }
        }

        const payload = {
            roster_id: shiftData.roster_id,
            department_id: safeUuid(shiftData.department_id)!,
            shift_date: shiftData.shift_date,
            start_time: shiftData.start_time,
            end_time: shiftData.end_time,
            organization_id: safeUuid(shiftData.organization_id),
            sub_department_id: safeUuid(shiftData.sub_department_id),
            group_type: shiftData.group_type || null,
            sub_group_name: shiftData.sub_group_name || null,
            display_order: shiftData.display_order || 0,
            shift_group_id: safeUuid(shiftData.shift_group_id),
            shift_subgroup_id: safeUuid(shiftData.shift_subgroup_id),
            roster_subgroup_id: safeUuid(shiftData.shift_subgroup_id),
            role_id: safeUuid(shiftData.role_id),
            remuneration_level: shiftData.remuneration_level !== undefined && shiftData.remuneration_level !== null ? Number(shiftData.remuneration_level) : null,
            paid_break_minutes: shiftData.paid_break_minutes || 0,
            unpaid_break_minutes: shiftData.unpaid_break_minutes || 0,
            break_minutes: (shiftData.paid_break_minutes || 0) + (shiftData.unpaid_break_minutes || 0),
            break_start: shiftData.break_start || null,
            break_end: shiftData.break_end || null,
            timezone: shiftData.timezone || 'Australia/Sydney',
            start_at: shiftData.start_at || null,
            end_at: shiftData.end_at || null,
            assigned_employee_id: safeUuid(shiftData.assigned_employee_id),
            required_skills: shiftData.required_skills || [],
            required_licenses: shiftData.required_licenses || [],
            event_ids: shiftData.event_ids || [],
            tags: shiftData.tags || [],
            notes: shiftData.notes || null,
            template_id: safeUuid(shiftData.template_id),
            template_group: shiftData.template_group || null,
            template_sub_group: shiftData.template_sub_group || null,
            is_from_template: shiftData.is_from_template || false,
            template_instance_id: safeUuid(shiftData.template_instance_id),
            lifecycle_status: 'Draft',
            is_draft: true,
            created_by_user_id: user.id,
            creation_source: shiftData.creation_source ?? (shiftData.is_from_template ? 'template' : 'manual'),
            assignment_source: shiftData.assigned_employee_id ? (shiftData.assignment_source ?? 'direct') : null,
            is_training: shiftData.is_training ?? false,
            // Planning target. `null` = "Any employment type". Persisted by
            // sm_create_shift as of 20260805060000 — before that migration this
            // key was silently swallowed by the RPC's explicit column list.
            target_employment_type: shiftData.target_employment_type ?? null,
            // Coerce the pair into a coherent state rather than letting
            // shifts_target_flexible_requires_pt_check reject the write: the flag
            // is only meaningful for a PT target.
            target_requires_flexible:
                shiftData.target_employment_type === 'PT'
                    ? (shiftData.target_requires_flexible ?? false)
                    : false,
        };

        const newV8ShiftId = await callRpc('sm_create_shift', {
            p_shift_data: payload,
            p_user_id: user.id,
        }, CreateShiftResponseSchema);

        const newShift = await shiftsQueries.getShiftById(newV8ShiftId);
        if (!newShift) {
            throw new Error('Shift created but could not be retrieved');
        }

        return newShift;
    },

    /* ============================================================
       UPDATE SHIFT
       ============================================================ */

    async updateShift(shiftId: string, updates: UpdateShiftData): Promise<Shift> {
        const user = await requireUser();

        // Prevent modification if the shift is in the past
        const currentShift = await shiftsQueries.getShiftById(shiftId);
        if (currentShift) {
            const now = new Date();
            const shiftStartAt = parseZonedDateTime(currentShift.shift_date, currentShift.start_time, SYDNEY_TZ);
            if (now >= shiftStartAt) {
                throw new Error('Cannot edit a shift that is in the past.');
            }

            // ── Layer 1: shape of the shift AFTER this edit ───────────────────
            // Merged onto the current row rather than read from the patch alone:
            // a patch that only shortens `end_time` still has to be judged
            // against the break minutes already on the shift, and a patch that
            // only clears the unpaid break has to be judged against the existing
            // length. Evaluating the patch in isolation would miss both.
            //
            // Only runs when the edit actually touches an intrinsic field, so
            // re-grouping or re-noting a shift never re-litigates its shape.
            const TOUCHES_SHAPE = [
                'start_time', 'end_time', 'shift_date',
                'unpaid_break_minutes', 'paid_break_minutes',
                'break_start', 'break_end',
                'is_training', 'role_id',
                'target_employment_type', 'target_requires_flexible',
            ] as const;

            if (TOUCHES_SHAPE.some(k => updates[k] !== undefined)) {
                // Field-by-field rather than `{ ...current, ...updates }`: object
                // spread copies a key that is PRESENT-but-undefined, so a patch
                // built as `{ target_employment_type: undefined }` would blank an
                // 'FT' target down to the untargeted default and quietly relax
                // the 7.6h floor to 3h. `!== undefined` cannot be fooled that way.
                const pick = <K extends keyof UpdateShiftData & keyof Shift>(key: K) =>
                    (updates[key] !== undefined ? updates[key] : currentShift[key]);

                await assertShapeForRow(
                    {
                        shift_date:               pick('shift_date') as string,
                        start_time:               pick('start_time') as string,
                        end_time:                 pick('end_time') as string,
                        unpaid_break_minutes:     pick('unpaid_break_minutes') as number,
                        paid_break_minutes:       pick('paid_break_minutes') as number,
                        break_start:              pick('break_start') as string | null,
                        break_end:                pick('break_end') as string | null,
                        is_training:              pick('is_training') as boolean,
                        target_employment_type:   pick('target_employment_type') as string | null,
                        target_requires_flexible: pick('target_requires_flexible') as boolean,
                        role_id:                  pick('role_id') as string | null,
                        // The joined role travels with the row, so an edit that
                        // leaves `role_id` alone needs no lookup at all.
                        role_name:
                            updates.role_id === undefined
                                ? currentShift.roles?.name ?? null
                                : null,
                    },
                    { rpcName: 'sm_apply_shift_op' },
                );
            }
        }

        // ── Split the incoming patch into two buckets ──────────────────────────
        //
        //  (1) editPayload — schedule + grouping fields (and, on a DRAFT shift,
        //      the assignment) that the audited gateway 'edit' op WHITELISTS.
        //      These flow through sm_apply_shift_op so the action lands in the
        //      shift_events ledger as a SINGLE record (state + field diff +
        //      folded assignment).
        //
        //  (2) excludedPayload — fields the gateway 'edit' op DELIBERATELY does
        //      NOT own (structural/RLS-scoping moves, canonical timestamps, jsonb
        //      eligibility arrays, cancellation reason). These keep their existing
        //      direct-update behaviour so nothing regresses.
        //
        // Gateway 'edit' whitelist (payload keys, per 20260630001100):
        //   start_time, end_time, shift_date, paid_break_minutes,
        //   unpaid_break_minutes, break_start, break_end (20261025102855),
        //   notes, role_id, sub_department_id,
        //   remuneration_level_id, group_type, sub_group_name, display_order,
        //   shift_group_id, shift_subgroup_id, timezone, is_training,
        //   assigned_employee_id, assignment_source
        const editPayload: Record<string, unknown> = {};

        if (updates.start_time !== undefined) editPayload.start_time = updates.start_time;
        if (updates.end_time !== undefined) editPayload.end_time = updates.end_time;
        if (updates.shift_date !== undefined) editPayload.shift_date = updates.shift_date;
        if (updates.paid_break_minutes !== undefined)
            editPayload.paid_break_minutes = updates.paid_break_minutes;
        if (updates.unpaid_break_minutes !== undefined)
            editPayload.unpaid_break_minutes = updates.unpaid_break_minutes;
        // null passes through: shortening a shift under five hours clears its break.
        if (updates.break_start !== undefined) editPayload.break_start = updates.break_start;
        if (updates.break_end !== undefined) editPayload.break_end = updates.break_end;
        // notes: pass through even when null so it can be explicitly cleared
        // (the gateway uses the `?` operator to allow clearing).
        if (updates.notes !== undefined) editPayload.notes = updates.notes;
        if (updates.role_id !== undefined)
            editPayload.role_id = safeUuid(updates.role_id);
        if (updates.sub_department_id !== undefined)
            editPayload.sub_department_id = safeUuid(updates.sub_department_id);
        if (updates.remuneration_level !== undefined)
            editPayload.remuneration_level = updates.remuneration_level !== null ? Number(updates.remuneration_level) : null;
        if (updates.group_type !== undefined) editPayload.group_type = updates.group_type;
        // sub_group_name: pass through even when null so it can be explicitly cleared.
        if (updates.sub_group_name !== undefined)
            editPayload.sub_group_name = updates.sub_group_name;
        if (updates.display_order !== undefined)
            editPayload.display_order = updates.display_order;
        if (updates.shift_group_id !== undefined)
            editPayload.shift_group_id = safeUuid(updates.shift_group_id);
        // Payload key is `shift_subgroup_id`; the gateway maps it to the DB column
        // roster_subgroup_id internally. (Preserves the old "only set when a valid
        // UUID is present" behaviour — a null/invalid value is simply omitted, so
        // COALESCE keeps the existing subgroup.)
        if (updates.shift_subgroup_id !== undefined) {
            const safeSubgroupId = safeUuid(updates.shift_subgroup_id);
            if (safeSubgroupId) {
                editPayload.shift_subgroup_id = safeSubgroupId;
            }
        }
        if (updates.timezone !== undefined) editPayload.timezone = updates.timezone;
        if (updates.is_training !== undefined) editPayload.is_training = updates.is_training;

        // Assignment is FOLDED into the single audited `edit` op so an
        // edit-and-reassign on a DRAFT shift produces ONE shift_events record
        // (the gateway gates the fold on assign/unassign FSM legality and its
        // via_gateway guard suppresses the duplicate trigger ASSIGNED row).
        // Pass an explicit `null` (not undefined) when clearing so the key
        // survives JSON serialization and the gateway sees the unassign intent.
        // Published-shift assignment changes are gated out server-side and keep
        // their dedicated assign/emergency path.
        if (updates.assigned_employee_id !== undefined) {
            const empId = safeUuid(updates.assigned_employee_id);
            editPayload.assigned_employee_id = empId ?? null;
            editPayload.assignment_source = empId
                ? (updates.assignment_source ?? 'manual')
                : null;
        }

        // ── Non-whitelist fields: preserve the existing direct-update path ─────
        // These are NOT silently dropped. roster_id/department_id/organization_id
        // are structural moves; start_at/end_at are canonical timestamps; the jsonb
        // arrays + cancellation_reason are owned by other pipelines. (Assignment
        // now flows through the audited `edit` op above, not here.)
        const excludedPayload: Record<string, unknown> = {};

        if (updates.roster_id !== undefined)
            excludedPayload.roster_id = safeUuid(updates.roster_id);
        if (updates.department_id !== undefined)
            excludedPayload.department_id = safeUuid(updates.department_id);
        if (updates.organization_id !== undefined)
            excludedPayload.organization_id = safeUuid(updates.organization_id);
        if (updates.start_at !== undefined) excludedPayload.start_at = updates.start_at;
        if (updates.end_at !== undefined) excludedPayload.end_at = updates.end_at;
        if (updates.required_skills !== undefined)
            editPayload.required_skills = updates.required_skills;
        if (updates.required_licenses !== undefined)
            editPayload.required_licenses = updates.required_licenses;
        if (updates.event_ids !== undefined)
            editPayload.event_ids = updates.event_ids;
        if (updates.tags !== undefined) excludedPayload.tags = updates.tags;
        if (updates.cancellation_reason !== undefined)
            excludedPayload.cancellation_reason = updates.cancellation_reason;

        // Employment target: a PLANNING attribute, in the same family as `tags`.
        // It is deliberately NOT routed through the gateway `edit` op — that op's
        // server-side whitelist does not carry these keys, so sending them there
        // would be silently dropped (`NO_EDITABLE_FIELDS` / ignored key). It also
        // drives no FSM transition, so the direct-update path the other planning
        // fields already use is the correct home. It DOES now drive the Layer-1
        // shape gate at the top of this method — which is why that gate reads the
        // merged post-update value rather than the payload assembled here.
        //
        // Both keys move together so the pair can never violate
        // shifts_target_flexible_requires_pt_check: clearing the type to "Any"
        // must also clear the flexible flag.
        // The flag is only writable alongside the type it qualifies. Writing it
        // alone is rejected rather than guessed at: we would have to read the
        // shift's current target to know whether `true` is even legal, and a
        // wrong guess either trips the CHECK or silently clears the planner's
        // intent. Every caller in the app submits the pair together.
        if (updates.target_employment_type !== undefined) {
            const nextTarget = updates.target_employment_type ?? null;
            excludedPayload.target_employment_type = nextTarget;
            excludedPayload.target_requires_flexible =
                nextTarget === 'PT' ? (updates.target_requires_flexible ?? false) : false;
        }

        const hasEdit = Object.keys(editPayload).length > 0;
        const hasExcluded = Object.keys(excludedPayload).length > 0;

        // ── (1) Schedule/grouping edits → audited gateway op ──────────────────
        if (hasEdit) {
            // The gateway performs CAS against the EXACT current version, so an
            // expected version is mandatory. If the caller did not supply one,
            // read the current version (non-critical updates that omit it keep
            // working — we just fetch the head version to satisfy the contract).
            let expectedVersion = updates.expectedVersion;
            if (expectedVersion === undefined) {
                const current = await shiftsQueries.getShiftById(shiftId);
                if (!current) {
                    throw new Error('Shift not found or has been deleted.');
                }
                expectedVersion = current.version;
            }

            const envelope = await callRpc(
                'sm_apply_shift_op',
                {
                    p_shift_id: shiftId,
                    p_expected_version: expectedVersion,
                    p_op: 'edit',
                    p_payload: { ...editPayload, reason: 'Shift edited' },
                    p_idempotency_key: null,
                },
                ApplyShiftOpResponseSchema,
            );

            switch (envelope.code) {
                case 'APPLIED':
                case 'IDEMPOTENT_REPLAY':
                    break;
                case 'VERSION_CONFLICT':
                    throw new Error(
                        'This shift was modified by someone else (concurrent modification). ' +
                        'Reload and try again.',
                    );
                case 'ILLEGAL_TRANSITION':
                    throw new Error(
                        `This edit is not allowed in the shift's current state (${envelope.current_state ?? 'unknown'}).`,
                    );
                case 'FORBIDDEN':
                    throw new Error('You do not have permission to edit this shift.');
                case 'GONE':
                    throw new Error('Shift not found or has been deleted.');
                case 'WRITE_REJECTED':
                    throw new Error(`Shift edit was rejected: ${envelope.details ?? envelope.note ?? 'unknown reason'}`);
                default:
                    throw new Error(envelope.error ?? 'Failed to edit shift.');
            }
        }

        // ── (2) Non-whitelist fields → existing direct-update path ────────────
        // Behaviour-preserving: same direct UPDATE the legacy code used (the
        // legacy RPC sm_update_shift is broken via a missing notify_user fn).
        // Only runs when there are excluded fields to write.
        if (hasExcluded) {
            let query = supabase
                .from('shifts')
                .update({
                    ...excludedPayload,
                    updated_at:       new Date().toISOString(),
                    last_modified_by: user.id,
                })
                .eq('id', shiftId);

            // Honour optimistic concurrency when the caller passed a version. If
            // the gateway 'edit' op already ran above, it bumped the version, so
            // only gate on the original expected version when there was NO edit.
            if (updates.expectedVersion !== undefined && !hasEdit) {
                query = query.eq('version', updates.expectedVersion);
            }

            const { data: updatedRows, error: updateError } = await query.select('id');

            if (updateError) {
                throw new Error(updateError.message);
            }

            if (!updatedRows || updatedRows.length === 0) {
                throw new Error('No rows were updated. The shift may have been modified by another user.');
            }
        }

        const updatedShift = await shiftsQueries.getShiftById(shiftId);
        if (!updatedShift) {
            throw new Error('Shift updated but could not be retrieved');
        }

        return updatedShift;
    },

    /* ============================================================
       ATOMIC BULK ASSIGN SHIFTS (multi-employee)
       ============================================================ */

    /**
     * Assign multiple (employee → shifts[]) pairs in a single atomic DB
     * transaction via the sm_bulk_assign_atomic RPC.
     *
     * @param assignments       Array of { employeeId, shiftIds } pairs.
     * @param expectedVersions  shift id → the version the caller's compliance
     *                          check saw. A shift changed since then (or absent
     *                          from the map) is not booked and comes back in
     *                          `conflicts`. A shift already assigned to the
     *                          intended employee counts as booked, so a retry
     *                          is safe.
     */
    async bulkAssignShiftsAtomic(
        assignments: { employeeId: string; shiftIds: string[] }[],
        expectedVersions?: Record<string, number>,
    ): Promise<BulkAssignAtomicResponse> {
        if (assignments.length === 0) {
            return {
                success: true,
                total_requested: 0,
                success_count: 0,
                conflict_count: 0,
                conflicts: [],
                per_employee: [],
            };
        }

        // Build the JSONB array the RPC expects:
        // [{ "employee_id": uuid, "shift_ids": [uuid, ...] }, ...]
        const p_assignments = assignments.map(a => ({
            employee_id: a.employeeId,
            shift_ids: a.shiftIds,
        }));

        return callAuthenticatedRpc(
            'sm_bulk_assign_atomic',
            (userId) => ({
                p_assignments,
                p_user_id:           userId,
                p_expected_versions: expectedVersions ?? null,
            }),
            BulkAssignAtomicResponseSchema,
        );
    },




    async publishShift(shiftId: string): Promise<{ success: true }> {
        // One shift through the bulk path, so it gets the same checks. It used to
        // skip compliance ("checked at assignment time"), but a draft can sit for
        // a week while its assignee picks up other shifts, and the rules must
        // hold on the day it is published, not the day it was drafted.
        const res = await this.bulkPublishShifts([shiftId]);
        if (res.publishedIds.includes(shiftId)) return { success: true };
        const failure = [...res.complianceFailed, ...res.dbFailed].find(f => f.id === shiftId);
        throw new Error(failure?.reason ?? 'Failed to publish shift.');
    },

    async bulkPublishShifts(shiftIds: string[]): Promise<BulkPublishPartialResult> {
        // Per-shift compliance pre-check — does NOT block the whole batch on a single failure.
        // Also identifies assigned shifts with TTS < 4h (emergency set) so they bypass the
        // offer flow and land directly on S4 (Confirmed) rather than S3 (Offered).
        //
        // Fails CLOSED. A shift that cannot be read, or whose compliance the engine
        // never answered for, is not published. Both used to pass: each shift was
        // re-read with getShiftById, whose `null` on any error looked like "no
        // assignee", and an unreachable edge function fell back to a local check
        // that reports `passed`.
        const emergencySet = new Set<string>();

        // One batched read for every shift, instead of one request per shift.
        let shiftById: Map<string, PublishCheckRow>;
        try {
            shiftById = await shiftsQueries.getPublishCheckRows(shiftIds);
        } catch (e: any) {
            const reason = `Could not load the shift to check it before publishing (${e?.message ?? 'unknown error'}). Nothing was published — try again.`;
            return { publishedIds: [], complianceFailed: shiftIds.map(id => ({ id, reason })), dbFailed: [] };
        }

        // Bounded: at most DEFAULT_CHUNK_CONCURRENCY (5) compliance calls in flight (processInChunks).
        // Firing all N at once is the burst most likely to make the edge function error (F-06).
        const complianceChecks = await processInChunks(
            shiftIds,
            async (id) => {
                const shift = shiftById.get(id);
                if (!shift) {
                    return { id, pass: false as const, reason: 'Shift not found — it may have been deleted. Reload the roster.' };
                }
                const ttsMs = shift.start_at
                    ? new Date(shift.start_at).getTime() - Date.now()
                    : parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now();
                if (ttsMs <= 0) {
                    return { id, pass: false as const, reason: 'Already started — too late to publish' };
                }
                // Unassigned shifts: no compliance needed. BUT inside the 4h emergency
                // window, opening bidding (S5) auto-expires back to Draft (S1) — so skip
                // the no-op and surface the emergency-assignment hint instead of passing.
                if (!shift.assigned_employee_id || !isValidUuid(shift.assigned_employee_id)) {
                    if (shift.target_employment_type === 'FT') {
                        return { id, pass: false as const, reason: FT_UNASSIGNED };
                    }
                    if (ttsMs <= EMERGENT_WINDOW_MS) {
                        return {
                            id,
                            pass: false as const,
                            reason: 'Starts within 4h — assign an employee to emergency-publish (bidding would expire)',
                        };
                    }
                    return { id, pass: true as const, reason: '' };
                }
                const netMinutes =
                    calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                    - (shift.unpaid_break_minutes || 0);
                const validation = await complianceService.validateShiftCompliance(
                    shift.assigned_employee_id,
                    shift.shift_date,
                    shift.start_time,
                    shift.end_time,
                    netMinutes,
                    id,
                );
                if (!validation.isValid) {
                    return { id, pass: false as const, reason: complianceFailureReason(validation) };
                }
                if (!validation.engineReached) {
                    return { id, pass: false as const, reason: COMPLIANCE_NOT_CHECKED };
                }
                // Flag assigned shifts within the 4h lock window for emergency publish
                if (ttsMs <= EMERGENT_WINDOW_MS) {
                    emergencySet.add(id);
                }
                return { id, pass: true as const, reason: '' };
            },
            DEFAULT_CHUNK_CONCURRENCY,
        );

        const complianceFailed: Array<{ id: string; reason: string }> = [];
        const passIds: string[] = [];

        for (const check of complianceChecks) {
            if (!check.ok) {
                complianceFailed.push({ id: check.id, reason: `Compliance check error: ${check.error}` });
            } else if (!check.value.pass) {
                complianceFailed.push({ id: check.id, reason: check.value.reason });
            } else {
                passIds.push(check.id);
            }
        }

        // Nothing passes compliance — skip the DB round-trip entirely
        if (passIds.length === 0) {
            return { publishedIds: [], complianceFailed, dbFailed: [] };
        }

        // Split: normal publish via RPC; emergency publish via direct update (S2 → S4, no offer).
        const normalIds    = passIds.filter(id => !emergencySet.has(id));
        const emergencyIds = passIds.filter(id =>  emergencySet.has(id));

        const publishedIds: string[] = [];
        const dbFailed: Array<{ id: string; reason: string }> = [];

        // Normal path — bulk publish via RPC
        if (normalIds.length > 0) {
            try {
                const result = await callAuthenticatedRpc(
                    'sm_bulk_publish_shifts',
                    (userId) => ({
                        p_shift_ids: normalIds,
                        p_actor_id: userId,
                        // The version each shift had when it was checked. The server
                        // refuses any that changed since (stale_ids): an unassigned
                        // draft the autoscheduler assigned a second ago was otherwise
                        // offered to someone no check ever saw.
                        p_expected_versions: Object.fromEntries(
                            normalIds.map(id => [id, shiftById.get(id)!.version]),
                        ),
                    }),
                    BulkPublishResponseSchema,
                );
                const staleIds = new Set<string>(result.stale_ids ?? []);

                if (result.success === false) {
                    // RPC signalled a hard failure — the whole batch was rejected.
                    // The RPC's error branch sends `error` (SQLERRM), not `message`;
                    // reading only `message` reduced every refusal to the same
                    // "Bulk publish failed", whatever the cause.
                    const reason = result.error || result.message || 'Bulk publish failed';
                    normalIds.forEach(id => dbFailed.push({ id, reason }));
                } else {
                    // Forward-compatibility: if a future RPC version returns a per-shift
                    // errors array, use it as the primary source of truth.
                    const hasLegacyErrors = Array.isArray(result.errors) && result.errors.length > 0;
                    if (hasLegacyErrors) {
                        const errorMap = new Map(
                            (result.errors as Array<{ shift_id: string; reason: string }>)
                                .map((e) => [e.shift_id, e.reason])
                        );
                        for (const id of normalIds) {
                            if (errorMap.has(id)) {
                                dbFailed.push({ id, reason: errorMap.get(id)! });
                            } else {
                                publishedIds.push(id);
                            }
                        }
                    } else if (
                        // Fast path: the RPC confirms every requested shift was updated.
                        // failure_count === 0 (or success_count exactly matches) means we can
                        // trust the full normalIds list without a round-trip.
                        typeof result.failure_count === 'number' && result.failure_count === 0
                    ) {
                        normalIds.forEach(id => publishedIds.push(id));
                    } else if (
                        // Discrepancy detected: the RPC silently skipped some shifts
                        // (e.g. wrong FSM state, shift starts in the past, S1+emergency).
                        // failure_count > 0, OR success_count returned and doesn't match
                        // the count we sent. Fetch ground-truth from the DB to classify each
                        // shift individually — never fabricate success.
                        (typeof result.failure_count === 'number' && result.failure_count > 0)
                        || (typeof result.success_count === 'number' && result.success_count !== normalIds.length)
                    ) {
                        try {
                            const publishedSet = await readPublishedIds(normalIds);
                            for (const id of normalIds) {
                                if (publishedSet.has(id)) {
                                    publishedIds.push(id);
                                } else {
                                    dbFailed.push({
                                        id,
                                        reason: staleIds.has(id)
                                            ? CHANGED_SINCE_CHECK
                                            : 'Skipped by server (not in a publishable state or starts in the past)',
                                    });
                                }
                            }
                        } catch (verifyError: any) {
                            // We cannot safely claim any shift was published; the
                            // manager can reload to see the real state.
                            normalIds.forEach(id =>
                                dbFailed.push({ id, reason: `Could not verify publish status: ${verifyError.message}` })
                            );
                        }
                    } else {
                        // Neither failure_count nor success_count was present in the response
                        // (e.g. older RPC that predates these fields). Optimistically trust the
                        // RPC's success flag — this is the same behaviour the code had before
                        // the reconciliation logic was introduced.
                        normalIds.forEach(id => publishedIds.push(id));
                    }
                }
            } catch (e: any) {
                // The call can fail AFTER the server committed (connection dropped,
                // laptop lid closed): the publish is one transaction, so it either
                // all landed or none did. Ask the database which, instead of
                // reporting shifts as failed that employees have already been offered.
                try {
                    const publishedSet = await readPublishedIds(normalIds);
                    for (const id of normalIds) {
                        if (publishedSet.has(id)) publishedIds.push(id);
                        else dbFailed.push({ id, reason: e.message });
                    }
                } catch {
                    const reason = `Could not confirm whether it was published (${e.message}). Reload the roster to check.`;
                    normalIds.forEach(id => dbFailed.push({ id, reason }));
                }
            }
        }

        // Emergency path — publish + confirm atomically (S2 → S4) via the audited
        // gateway. sm_apply_shift_op('publish') detects the TTS<4h + assigned case
        // and does the emergency-confirm write server-side (migration 20260721013000),
        // with a real row lock + version CAS. This used to be a direct, unprotected
        // `supabase.from('shifts').update()` here — the exact gap
        // docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §6 flagged as
        // needing to close before Reserve List's own writes could rely on the same
        // pattern. One RPC call per shift, since
        // the gateway is single-shift by design.
        //
        // The expected version is the one read alongside the compliance check, so
        // a shift reassigned after its check is refused (VERSION_CONFLICT) rather
        // than confirmed onto someone nobody checked. It used to be re-read here,
        // after the check, and a failed re-read reported "Shift not found".
        if (emergencyIds.length > 0) {
            await Promise.all(
                emergencyIds.map(async (id) => {
                    try {
                        const envelope = await callRpc(
                            'sm_apply_shift_op',
                            {
                                p_shift_id: id,
                                p_expected_version: shiftById.get(id)!.version,
                                p_op: 'publish',
                                p_payload: { reason: 'Emergency publish' },
                                p_idempotency_key: null,
                            },
                            ApplyShiftOpResponseSchema,
                        );
                        if (envelope.code === 'APPLIED' || envelope.code === 'IDEMPOTENT_REPLAY') {
                            publishedIds.push(id);
                        } else {
                            dbFailed.push({ id, reason: emergencyPublishRefusal(envelope) });
                        }
                    } catch (e: any) {
                        dbFailed.push({ id, reason: e?.message ?? 'Emergency publish failed' });
                    }
                }),
            );
        }

        return { publishedIds, complianceFailed, dbFailed };
    },

    async bulkUnpublishShifts(shiftIds: string[]): Promise<BulkUnpublishPartialResult> {
        if (!shiftIds || shiftIds.length === 0) return { unpublishedIds: [], failed: [] };

        // processInChunks: 20 at a time, fully parallel within each chunk
        const results = await processInChunks(
            shiftIds,
            (id) => this.unpublishShift(id, 'Bulk unpublish'),
        );

        const unpublishedIds: string[] = [];
        const failed: Array<{ id: string; reason: string }> = [];

        for (const r of results) {
            if (r.ok) {
                unpublishedIds.push(r.id);
            } else {
                failed.push({ id: r.id, reason: (r as any).error });
            }
        }

        return { unpublishedIds, failed };
    },

    async unpublishShift(shiftId: string, reason?: string) {
        const shift = await shiftsQueries.getShiftById(shiftId);
        if (shift) {
            const now = new Date();
            const shiftStartAt = parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ);
            if (now >= shiftStartAt) {
                throw new Error('Cannot unpublish a shift that is in the past.');
            }
        }

        const result = await callAuthenticatedRpc(
            'sm_unpublish_shift',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: reason ?? 'Unpublished' }),
            PublishShiftResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to unpublish shift');
        }

        return result;
    },

    /* ============================================================
       CANCEL SHIFT
       ============================================================ */

    /* ============================================================
       DELETE SHIFT
       ============================================================ */

    /**
     * Permanently delete one shift. The database refuses a started or worked
     * shift (code SHIFT_STARTED / SHIFT_WORKED) and, when `expectedVersion` is
     * given, one someone else changed meanwhile (VERSION_CONFLICT). The code is
     * attached to the thrown error as `.code`.
     */
    async deleteShift(shiftId: string, expectedVersion?: number): Promise<boolean> {
        if (!shiftId || !isValidUuid(shiftId)) return false;

        const result = await callAuthenticatedRpc(
            'sm_delete_shift',
            (userId) => ({
                p_shift_id: shiftId,
                p_user_id: userId,
                p_reason: 'Manual deletion',
                p_expected_version: expectedVersion ?? null,
            }),
            DeleteShiftResponseSchema,
        );

        if (!result.success) {
            throw Object.assign(new Error(result.error ?? 'Failed to delete shift on the server.'), { code: result.code });
        }

        return true;
    },

    /* ============================================================
       BULK DELETE SHIFTS
       ============================================================ */

    async bulkDeleteShifts(shiftIds: string[]): Promise<number> {
        if (!shiftIds || shiftIds.length === 0) return 0;

        const result = await callAuthenticatedRpc(
            'sm_bulk_delete_shifts',
            (userId) => ({ p_shift_ids: shiftIds, p_deleted_by: userId, p_reason: 'Bulk manual deletion' }),
            BulkDeleteResponseSchema,
        );

        return result.success_count;
    },

    /**
     * Per-item bulk delete mapped to sm_bulk_delete_shifts RPC to avoid 429 Too Many Requests.
     * Replaces the coarse map/chunk logic.
     */
    async bulkDeleteShiftsPerItem(shiftIds: string[]): Promise<BulkDeletePartialResult> {
        if (!shiftIds || shiftIds.length === 0) return { deletedIds: [], failed: [] };

        try {
            const result = await callAuthenticatedRpc(
                'sm_bulk_delete_shifts',
                (userId) => ({ p_shift_ids: shiftIds, p_deleted_by: userId, p_reason: 'Bulk manual deletion' }),
                BulkDeleteResponseSchema,
            );

            if (result.success !== false) {
                // Per item: a started or worked shift refuses itself, not the batch.
                return {
                    deletedIds: result.deleted_ids ?? [],
                    failed: result.failed ?? [],
                };
            } else {
                return { deletedIds: [], failed: shiftIds.map(id => ({ id, reason: result.error || 'Bulk delete failed' })) };
            }
        } catch (e: any) {
            return { deletedIds: [], failed: shiftIds.map(id => ({ id, reason: e.message })) };
        }
    },

    /**
     * Async compliance pre-check for a set of shifts BEFORE the user confirms publish.
     * Runs per-shift compliance in parallel chunks (20 at a time).
     * Returns eligible IDs, compliance-failed IDs, and already-published (skipped) IDs.
     *
     * Used by the VALIDATING phase in BulkActionsToolbar to surface compliance results
     * to the user BEFORE they click "Confirm Publish".
     */
    async validateBulkPublishCompliance(shifts: Shift[]): Promise<BulkPublishValidationResult> {
        const eligible: string[] = [];
        const complianceFailed: Array<{ id: string; reason: string }> = [];
        const skipped: Array<{ id: string; reason: string }> = [];

        const checks = await processInChunks(
            shifts.map(s => s.id),
            async (id) => {
                const shift = shifts.find(s => s.id === id)!;

                // Already published → skip
                if (shift.lifecycle_status === 'Published') {
                    return { id, category: 'skipped' as const, reason: 'Already published' };
                }

                // Unassigned draft → eligible (compliance only applies to assigned shifts)
                if (!shift.assigned_employee_id || !isValidUuid(shift.assigned_employee_id)) {
                    return { id, category: 'eligible' as const, reason: '' };
                }

                // Assigned draft → run compliance check
                const netMinutes =
                    calculateMinutesBetweenTimes(shift.start_time, shift.end_time)
                    - (shift.unpaid_break_minutes || 0);

                const validation = await complianceService.validateShiftCompliance(
                    shift.assigned_employee_id,
                    shift.shift_date,
                    shift.start_time,
                    shift.end_time,
                    netMinutes,
                    id,
                );

                if (!validation.isValid) {
                    return { id, category: 'compliance_failed' as const, reason: complianceFailureReason(validation) };
                }
                // Same rule as bulkPublishShifts, so the preview never promises a
                // publish that the write will then refuse.
                if (!validation.engineReached) {
                    return { id, category: 'compliance_failed' as const, reason: COMPLIANCE_NOT_CHECKED };
                }

                return { id, category: 'eligible' as const, reason: '' };
            },
        );

        for (const r of checks) {
            if (!r.ok) {
                complianceFailed.push({ id: r.id, reason: (r as any).error });
            } else {
                switch (r.value.category) {
                    case 'eligible':          eligible.push(r.id); break;
                    case 'compliance_failed': complianceFailed.push({ id: r.id, reason: r.value.reason }); break;
                    case 'skipped':           skipped.push({ id: r.id, reason: r.value.reason }); break;
                }
            }
        }

        return { eligible, complianceFailed, skipped };
    },

    /* ============================================================
       EMPLOYEE ACTIONS (V3)
       ============================================================ */

    async acceptOffer(shiftId: string) {
        return callAuthenticatedRpc(
            'sm_accept_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId }),
            OfferActionResponseSchema,
        );
    },

    async rejectOffer(shiftId: string, reason: string) {
        // TTS-aware routing:
        //   TTS > 4h → sm_reject_offer → bidding (S5) — peers can still bid
        //   TTS ≤ 4h → sm_expire_offer_now → draft+assigned (S2) — bidding window closed,
        //              manager must use emergency assignment
        const { data: shift } = await (supabase as any)
            .from('shifts')
            .select('shift_date, start_time, start_at')
            .eq('id', shiftId)
            .single();

        if (shift) {
            const tts = shift.start_at
                ? new Date(shift.start_at).getTime() - Date.now()
                : parseZonedDateTime(shift.shift_date, shift.start_time, SYDNEY_TZ).getTime() - Date.now();

            if (tts <= 4 * 60 * 60 * 1000) {
                // Window closed — expire the offer, notify manager for emergency assignment
                return this.expireOfferNow(shiftId);
            }
        }

        return callAuthenticatedRpc(
            'sm_reject_offer',
            (userId) => ({ p_shift_id: shiftId, p_user_id: userId, p_reason: reason }),
            OfferActionResponseSchema,
        );
    },

    /**
     * Immediately expire a shift offer. Called client-side the moment the
     * countdown hits zero or isShiftLocked fires, so the DB transitions
     * S3 → S2 (Draft+Assigned) instantly without waiting for the cron.
     */
    async expireOfferNow(shiftId: string) {
        const { data, error } = await supabase.rpc('sm_expire_offer_now', {
            p_shift_id: shiftId,
        });
        if (error) throw error;
        return data as { success: boolean; error?: string; from_state?: string; to_state?: string };
    },

    /**
     * Employee drops an assigned shift (pushes to bidding based on time-to-start rules)
     * - >24h before start: on_bidding_normal (S5)
     * - 4-24h before start: on_bidding_urgent (S6)
     * - <4h before start: Blocked (RPC returns success=false with error message)
     */
    /**
     * `reasonCode` is a code from `cancellation_reasons`; `reason` is the
     * optional free-text note. Both are persisted onto the CANCELLED /
     * LATE_CANCELLED shift_event the RPC writes — before migration
     * 20260823090200 the reason was accepted and silently discarded.
     */
    async employeeDropShift(shiftId: string, reason?: string, reasonCode?: string) {
        const result = await callAuthenticatedRpc(
            'sm_employee_drop_shift',
            (userId) => ({
                p_shift_id: shiftId,
                p_employee_id: userId,
                p_reason: reason ?? null,
                p_reason_code: reasonCode ?? null,
            }),
            EmployeeDropResponseSchema,
        );

        if (!result.success) {
            throw new Error(result.error ?? 'Failed to drop shift');
        }

        return result;
    },
};
