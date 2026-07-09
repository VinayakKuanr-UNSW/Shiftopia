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
import { getSydneyNow, parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { getTimeRule } from './shift-ui';

// ============================================================
// TYPES
// ============================================================

/**
 * Pre-flight result — computed synchronously from local shift data.
 * `blocked`  = shifts that CANNOT be processed (will be skipped).
 * `warned`   = shifts that WILL be processed but carry a risk/side-effect.
 */
export interface BulkPreflightSummary {
    eligibleIds: string[];
    blocked: Array<{ id: string; reason: string }>;
    warned: Array<{ id: string; reason: string }>;
}

/**
 * Structured result returned by every bulk execution.
 * Enables partial-success UX — never treat a partial failure as total failure.
 */
export interface BulkExecutionResult {
    successIds: string[];
    failed: Array<{ id: string; reason: string }>;
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

    const now = getSydneyNow();

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

    const now = getSydneyNow();

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

/**
 * Unassign pre-flight.
 *
 * Eligible   — assigned, not in bidding, not cancelled
 * Blocked    — in bidding OR cancelled OR already unassigned
 */
export function preflightUnassign(shifts: Shift[]): BulkPreflightSummary {
    const eligibleIds: string[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];

    const now = getSydneyNow();

    for (const s of shifts) {
        const shiftStartAt = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
        const isPast = now >= shiftStartAt;

        if (isPast) {
            blocked.push({ id: s.id, reason: 'Shift is in the past' });
        } else if (s.bidding_status !== 'not_on_bidding') {
            blocked.push({ id: s.id, reason: 'In bidding' });
        } else if (s.is_cancelled || s.lifecycle_status === 'Cancelled') {
            blocked.push({ id: s.id, reason: 'Cancelled' });
        } else if (!s.assigned_employee_id) {
            blocked.push({ id: s.id, reason: 'Not assigned' });
        } else {
            eligibleIds.push(s.id);
        }
    }

    return { eligibleIds, blocked, warned: [] };
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
 *                     has started with nobody on it). These can never be staffed
 *                     and are deleted.
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
    /** W — unassigned drafts already "Live" (started, unstaffed): deleted. */
    deadIds: string[];
    /** Z — already-published shifts in the view: skipped (informational). */
    alreadyPublishedCount: number;
}

/** Emergency window — a shift that starts within this horizon is "emergent". */
const EMERGENT_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Compute the {@link PublishRosterPlan} from a set of shifts (typically the
 * loaded roster for the current org + date range + scope filter). Pure/sync —
 * no network. Only DRAFT shifts participate; published, in-progress, completed,
 * cancelled and deleted shifts are left untouched.
 *
 * Every draft shift falls into exactly one bucket:
 *   assigned future (X) · unassigned future (Y) · emergent assigned (A) ·
 *   emergent unassigned (B) · dead unassigned-live (W). Already-published shifts
 *   are only counted (Z).
 */
export function planPublishRoster(shifts: Shift[]): PublishRosterPlan {
    const assignedIds: string[] = [];
    const unassignedIds: string[] = [];
    const emergentAssignedIds: string[] = [];
    const emergentUnassignedIds: string[] = [];
    const deadIds: string[] = [];
    let alreadyPublishedCount = 0;

    const nowMs = getSydneyNow().getTime();

    for (const s of shifts) {
        if (!s.deleted_at && !s.is_cancelled && s.lifecycle_status === 'Published') {
            alreadyPublishedCount++;
        }

        const isPublishedOrTerminal =
            s.lifecycle_status === 'Published' ||
            s.lifecycle_status === 'InProgress' ||
            s.lifecycle_status === 'Completed' ||
            s.lifecycle_status === 'Cancelled';

        // Only DRAFT shifts are in scope.
        if (s.deleted_at || s.is_cancelled || isPublishedOrTerminal) continue;

        const isUnassigned = !s.assigned_employee_id;

        // Dead shift — an unassigned draft whose scheduled window is already LIVE.
        // It started with nobody on it and can never be staffed → delete.
        if (isUnassigned && getTimeRule(s)?.label === 'Live') {
            deadIds.push(s.id);
            continue;
        }

        // Resolve the start instant the same way getTimeRule does (canonical
        // start_at wins, else the wall-clock shift_date + start_time). Past-start
        // drafts that aren't "dead" (e.g. assigned but never published) can't be
        // published → skipped.
        const startMs = s.start_at
            ? new Date(s.start_at).getTime()
            : parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ).getTime();
        if (!Number.isFinite(startMs) || startMs <= nowMs) continue;

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
        alreadyPublishedCount,
    };
}

// ============================================================
// ASYNC CHUNK PROCESSOR
// ============================================================

/**
 * Process IDs in sequential chunks.
 *
 * Within each chunk, requests run in parallel (Promise.allSettled).
 * Chunks are processed sequentially — this prevents flooding the DB with
 * hundreds of simultaneous requests on large selections.
 *
 * Default chunk size: 20 (safe for Postgres connection pool limits).
 */
export async function processInChunks<T>(
    ids: string[],
    fn: (id: string) => Promise<T>,
    chunkSize = 20,
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
