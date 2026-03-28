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

    for (const s of shifts) {
        if (s.is_cancelled || s.lifecycle_status === 'Cancelled') {
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

    for (const s of shifts) {
        if (s.lifecycle_status !== 'Published') {
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

    for (const s of shifts) {
        if (s.bidding_status !== 'not_on_bidding') {
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
