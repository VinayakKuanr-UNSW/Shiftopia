/**
 * Bulk Action Engine
 *
 * Central layer for all bulk shift operations.
 * Provides:
 *   1. Sync pre-flight validation (O(n), no network — instant UI feedback)
 *   2. Chunked async execution (prevents API overload on large selections)
 *
 * All preflight functions return per-shift categorisation so the UI can show
 * "N eligible, M blocked, K warned" BEFORE the user confirms any action.
 */

import type { Shift } from './shift.entity';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

// ============================================================
// TYPES
// ============================================================

/**
 * Pre-flight result — computed synchronously from local shift data.
 * `blocked`  = shifts that CANNOT be processed (will be skipped).
 * `warned`   = shifts that WILL be processed but carry a risk/side-effect.
 */
interface BulkPreflightSummary {
    eligibleIds: string[];
    blocked: Array<{ id: string; reason: string }>;
    warned: Array<{ id: string; reason: string }>;
}


// ============================================================
// PRE-FLIGHT VALIDATORS (sync — no network calls)
// ============================================================

/**
 * Publish pre-flight.
 *
 * Eligible   — draft, not cancelled
 * Blocked    — already published OR cancelled
 * Warned     — eligible + assigned (compliance will run during execution)
 */
export function preflightPublish(shifts: Shift[]): BulkPreflightSummary {
    const eligibleIds: string[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];
    const warned: Array<{ id: string; reason: string }> = [];

    // Real "now" instant. shiftStartAt below is the absolute instant of the shift's
    // Sydney wall-clock start, so comparing against real now is correct in any tz.
    const now = new Date();

    for (const s of shifts) {
        const shiftStartAt = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
        const isPast = now >= shiftStartAt;

        if (isPast) {
            blocked.push({ id: s.id, reason: 'Shift is in the past' });
        } else if (s.is_cancelled || s.lifecycle_status === 'Cancelled') {
            blocked.push({ id: s.id, reason: 'Cancelled' });
        } else if (s.lifecycle_status === 'Published') {
            blocked.push({ id: s.id, reason: 'Already published' });
        } else {
            eligibleIds.push(s.id);
            if (s.assigned_employee_id) {
                warned.push({ id: s.id, reason: 'Compliance check required' });
            }
        }
    }

    return { eligibleIds, blocked, warned };
}

/**
 * Unpublish pre-flight.
 *
 * Eligible   — published, not in bidding
 * Blocked    — not published OR in bidding
 * Warned     — eligible + assigned (offer will be retracted from employee)
 */
export function preflightUnpublish(shifts: Shift[]): BulkPreflightSummary {
    const eligibleIds: string[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];
    const warned: Array<{ id: string; reason: string }> = [];

    // Real "now" instant. shiftStartAt below is the absolute instant of the shift's
    // Sydney wall-clock start, so comparing against real now is correct in any tz.
    const now = new Date();

    for (const s of shifts) {
        const shiftStartAt = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
        const isPast = now >= shiftStartAt;

        if (isPast) {
            blocked.push({ id: s.id, reason: 'Shift is in the past' });
        } else if (s.lifecycle_status !== 'Published') {
            blocked.push({ id: s.id, reason: 'Not published' });
        } else if (s.bidding_status !== 'not_on_bidding') {
            blocked.push({ id: s.id, reason: 'In bidding — withdraw first' });
        } else {
            eligibleIds.push(s.id);
            if (s.assigned_employee_id) {
                warned.push({ id: s.id, reason: 'Assigned — pending offer will be retracted' });
            }
        }
    }

    return { eligibleIds, blocked, warned };
}

/**
 * Delete pre-flight.
 *
 * All shifts are eligible (with confirmation).
 * Warned     — published or assigned (has side effects for employees).
 */
export function preflightDelete(shifts: Shift[]): BulkPreflightSummary {
    const eligibleIds: string[] = [];
    const warned: Array<{ id: string; reason: string }> = [];

    for (const s of shifts) {
        eligibleIds.push(s.id);
        if (s.lifecycle_status === 'Published' && s.assigned_employee_id) {
            warned.push({ id: s.id, reason: 'Published + assigned — employee offer cancelled' });
        } else if (s.lifecycle_status === 'Published') {
            warned.push({ id: s.id, reason: 'Published — removed from employee view' });
        }
    }

    return { eligibleIds, blocked: [], warned };
}



// ============================================================
// PUBLISH-ROSTER PLAN (one-click roster finalize)
// ============================================================

/**
 * Partition of the current roster for the "Publish" one-click action.
 *
 *   • assignedIds   — DRAFT + assigned + still in the future. Publishing sends
 *                     these to the assignee as Offers (or emergency-confirms
 *                     inside the 4h window).
 *   • unassignedIds — DRAFT + unassigned + still in the future. Publishing opens
 *                     these for Open Bidding.
 *   • deadIds       — DRAFT + unassigned + already "Live" (the scheduled window
 *                     has started with nobody on it). These can never be staffed,
 *                     and — having started — can never be deleted. Reported only.
 *
 * The three buckets are disjoint by construction: a dead shift is past-start,
 * a publishable shift is future-start.
 */
export interface PublishRosterPlan {
    /** X — future assigned drafts (TTS > 4h): sent to the assignee as Offers. */
    assignedIds: string[];
    /** Y — future unassigned drafts (TTS > 4h): opened for Open Bidding. */
    unassignedIds: string[];
    /**
     * A — assigned drafts inside the 4h window (TTS ≤ 4h): emergency-assigned
     * (published straight to Confirmed, bypassing the offer step).
     */
    emergentAssignedIds: string[];
    /**
     * B — unassigned drafts inside the 4h window (TTS ≤ 4h): CANNOT be opened for
     * bidding (it would immediately expire) — must be assigned manually. Skipped.
     */
    emergentUnassignedIds: string[];
    /** W — unassigned drafts already "Live" (started, unstaffed): skipped, never deleted. */
    deadIds: string[];
    /**
     * F — FULL-TIME assigned drafts, any time-to-start: published straight to
     * Confirmed (S4). Full-time hours are contracted — never offered.
     */
    fullTimeIds: string[];
    /** F0 — FULL-TIME drafts with nobody on them: skipped (an FT shift never goes to bidding). */
    fullTimeUnassignedIds: string[];
    /**
     * L — assigned drafts on a day the assignee has APPROVED leave: skipped. The
     * database refuses to publish them (`trg_shift_not_on_approved_leave`), and
     * `sm_bulk_publish_shifts` skips them; this says so before the manager confirms.
     */
    onLeaveIds: string[];
    /**
     * T — drafts whose start has passed (assigned and started, or already
     * ended): too late to publish, skipped. Unassigned drafts still inside their
     * window are W (`deadIds`) instead.
     */
    pastIds: string[];
    /**
     * P — drafts in a place where this manager may only view (e.g. delta there,
     * gamma elsewhere): skipped. Sending one would make the server refuse the
     * WHOLE batch.
     */
    noPermissionIds: string[];
    /** Z — already-published shifts in the view: skipped (informational). */
    alreadyPublishedCount: number;
}

/**
 * Emergency window — a shift that starts within this horizon is "emergent".
 * Inclusive (TTS ≤ 4h), matching SQL `get_time_category` (`<= 4` → EMERGENCY)
 * and shifts.commands' emergency routing.
 */
export const EMERGENT_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Compute the {@link PublishRosterPlan} from a set of shifts (typically the
 * loaded roster for the current org + date range + scope filter). Pure/sync —
 * no network. Only DRAFT shifts participate; published, in-progress, completed,
 * cancelled and deleted shifts are left untouched.
 *
 * Every draft shift falls into exactly one bucket:
 *   no permission (P) · dead unassigned-live (W) · too late (T) · on leave (L) ·
 *   full-time (F / F0) · emergent assigned (A) · emergent unassigned (B) ·
 *   assigned future (X) · unassigned future (Y). Already-published shifts are
 *   only counted (Z).
 */
export function planPublishRoster(
    shifts: Shift[],
    /** Is this employee on approved leave on this `yyyy-MM-dd`? Omitted ⇒ nobody is. */
    isOnApprovedLeave?: (employeeId: string, dateKey: string) => boolean,
    /** May this manager publish this shift where it sits? Omitted ⇒ everywhere. */
    canPublish?: (shift: Shift) => boolean,
): PublishRosterPlan {
    const assignedIds: string[] = [];
    const unassignedIds: string[] = [];
    const emergentAssignedIds: string[] = [];
    const emergentUnassignedIds: string[] = [];
    const deadIds: string[] = [];
    const fullTimeIds: string[] = [];
    const fullTimeUnassignedIds: string[] = [];
    const onLeaveIds: string[] = [];
    const pastIds: string[] = [];
    const noPermissionIds: string[] = [];
    let alreadyPublishedCount = 0;

    // Real epoch for absolute-instant math. getSydneyNow().getTime() would be a
    // wall-clock-shifted (fake) epoch and, subtracted from a real start_at epoch,
    // skews TTS by the viewer's offset on any non-Sydney runtime.
    const nowMs = Date.now();

    for (const s of shifts) {
        if (!s.is_cancelled && s.lifecycle_status === 'Published') {
            alreadyPublishedCount++;
        }

        const isPublishedOrTerminal =
            s.lifecycle_status === 'Published' ||
            s.lifecycle_status === 'InProgress' ||
            s.lifecycle_status === 'Completed' ||
            s.lifecycle_status === 'Cancelled';

        // Only DRAFT shifts are in scope.
        if (s.is_cancelled || isPublishedOrTerminal) continue;

        // Not this manager's to publish: reported, never sent (the server would
        // refuse the whole batch for it).
        if (canPublish && !canPublish(s)) {
            noPermissionIds.push(s.id);
            continue;
        }

        const startMs = s.start_at
            ? new Date(s.start_at).getTime()
            : parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ).getTime();
        const endMs = s.end_at
            ? new Date(s.end_at).getTime()
            : parseZonedDateTime(s.shift_date, s.end_time, SYDNEY_TZ).getTime();

        const isUnassigned = !s.assigned_employee_id;

        // Dead shift — an unassigned draft currently inside its scheduled window.
        // It started with nobody on it and can never be staffed → reported, left alone.
        if (isUnassigned && nowMs >= startMs && nowMs < endMs) {
            deadIds.push(s.id);
            continue;
        }
        if (!Number.isFinite(startMs)) continue;
        if (startMs <= nowMs) {
            pastIds.push(s.id);
            continue;
        }

        // Approved leave beats every other bucket: the shift cannot be published
        // to this person at all, whatever its type or time-to-start.
        if (!isUnassigned && isOnApprovedLeave?.(s.assigned_employee_id as string, s.shift_date)) {
            onLeaveIds.push(s.id);
            continue;
        }

        // Full-time: its own branch of the state machine (sm_publish_shift /
        // sm_bulk_publish_shifts) — confirmed directly, or skipped if unassigned.
        if (s.target_employment_type === 'FT') {
            if (isUnassigned) fullTimeUnassignedIds.push(s.id);
            else fullTimeIds.push(s.id);
            continue;
        }

        const isEmergent = startMs - nowMs <= EMERGENT_WINDOW_MS;

        if (isEmergent) {
            // Inside the 4h lock: assigned → emergency-assign; unassigned → can't
            // open bidding (would immediately expire), needs manual assignment.
            if (isUnassigned) emergentUnassignedIds.push(s.id);
            else emergentAssignedIds.push(s.id);
        } else if (isUnassigned) {
            unassignedIds.push(s.id);
        } else {
            assignedIds.push(s.id);
        }
    }

    return {
        assignedIds,
        unassignedIds,
        emergentAssignedIds,
        emergentUnassignedIds,
        deadIds,
        fullTimeIds,
        fullTimeUnassignedIds,
        onLeaveIds,
        pastIds,
        noPermissionIds,
        alreadyPublishedCount,
    };
}

// ============================================================
// ASYNC CHUNK PROCESSOR
// ============================================================

/**
 * Concurrency limit for bulk shift operations: 5 parallel requests.
 * Eliminates HTTP connection pool exhaustion, socket starvation, and 503 gateway
 * errors when calling Edge Functions and PostgREST during large bulk operations (F-06).
 */
export const DEFAULT_CHUNK_CONCURRENCY = 5;

/**
 * Process IDs in sequential chunks.
 *
 * Within each chunk, requests run in parallel (Promise.allSettled).
 * Chunks are processed sequentially — this prevents flooding the DB and
 * edge function HTTP gateway with hundreds of simultaneous requests on large selections.
 *
 * Default chunk size (concurrency): 5 (safe for Edge Function socket pools & Postgres).
 */
export async function processInChunks<T>(
    ids: string[],
    fn: (id: string) => Promise<T>,
    chunkSize = DEFAULT_CHUNK_CONCURRENCY,
): Promise<Array<{ id: string } & ({ ok: true; value: T } | { ok: false; error: string })>> {
    const results: Array<{ id: string } & ({ ok: true; value: T } | { ok: false; error: string })> = [];

    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const settled = await Promise.allSettled(
            chunk.map((id) => fn(id).then((value) => ({ id, ok: true as const, value }))),
        );

        for (let j = 0; j < settled.length; j++) {
            const r = settled[j];
            if (r.status === 'fulfilled') {
                results.push(r.value);
            } else {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                results.push({ id: chunk[j], ok: false, error: msg });
            }
        }
    }

    return results;
}
