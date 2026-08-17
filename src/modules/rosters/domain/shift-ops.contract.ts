/**
 * Shift Mutation Gateway — client contract + result→UX mapping.
 *
 * Pairs with the DB RPC `sm_apply_shift_op`, an optimistic-concurrency gateway
 * for shift mutations. The RPC returns a single jsonb result object whose `code`
 * field discriminates the outcome; this module mirrors that wire shape and maps
 * each outcome onto a UX intent (`ShiftOpUx`) the UI layer can act on.
 *
 * PINNED CONTRACT (must match the RPC exactly):
 *   sm_apply_shift_op(
 *     p_shift_id        uuid,
 *     p_expected_version int,
 *     p_op              text,
 *     p_payload         jsonb = {},
 *     p_idempotency_key uuid  = null
 *   ) returns jsonb
 *
 *   APPLIED / IDEMPOTENT_REPLAY → { ok:true,  code, version, state }
 *   WRITE_REJECTED              → { ok:false, code, note, version, state }
 *   VERSION_CONFLICT            → { ok:false, code, current_version, current_state,
 *                                   last_modified_by, updated_at, server_row }
 *   ILLEGAL_TRANSITION          → { ok:false, code, current_state, attempted }
 *   GONE / FORBIDDEN / ERROR    → { ok:false, code, error? }
 */

// The operation vocabulary is owned by the sibling legality module.
import type { ShiftOp } from './shift-op-legality';

// Re-export so downstream consumers can reference `ShiftOp` from one import.
export type { ShiftOp };

/** Result codes returned by `sm_apply_shift_op`, 1:1 with the RPC. */
export type ShiftOpCode =
    | 'APPLIED'
    | 'IDEMPOTENT_REPLAY'
    // The gateway passed authz + CAS + the FSM guard, but the write dispatcher
    // declined to mutate (e.g. the 4h publish window closed, a not-yet-ported op,
    // or a missing payload id). No row changed, so the version did NOT advance.
    | 'WRITE_REJECTED'
    | 'VERSION_CONFLICT'
    | 'ILLEGAL_TRANSITION'
    | 'GONE'
    | 'FORBIDDEN'
    // AutoPilot has atomically taken ownership of this swap/bid (it is resolving
    // it in the current overnight drain); a manual manager action is locked out
    // until it resolves or ownership is returned. Nothing changed — refresh.
    | 'AUTO_OWNER_ACTIVE'
    | 'ERROR';

/**
 * Normalized client-side view of the RPC's jsonb result. Every field beyond
 * `{ ok, code }` is optional because it is only populated for specific codes.
 */
export interface ShiftOpResult {
    ok: boolean;
    code: ShiftOpCode;
    // APPLIED / IDEMPOTENT_REPLAY / WRITE_REJECTED
    version?: number;
    state?: string;
    // WRITE_REJECTED — machine-readable reason (e.g. 'PUBLISH_TOO_LATE',
    // 'NOT_IMPLEMENTED', 'MISSING_WINNER_ID').
    note?: string;
    // VERSION_CONFLICT
    current_version?: number;
    current_state?: string;
    last_modified_by?: string;
    updated_at?: string;
    server_row?: Record<string, unknown>;
    // ILLEGAL_TRANSITION
    attempted?: string;
    // GONE / FORBIDDEN / ERROR
    error?: string;
}

/**
 * UX intent derived from a `ShiftOpResult`. The UI layer reads this rather than
 * switching on raw result codes, so toast copy + refresh/diff behavior stay
 * consistent across every call site.
 */
export interface ShiftOpUx {
    kind: 'success' | 'rejected' | 'conflict' | 'illegal' | 'gone' | 'forbidden' | 'auto_owned' | 'error';
    /** Toast copy to surface, if any. `undefined` ⇒ no toast (silent success). */
    toast?: string;
    /** Caller should re-fetch the shift / roster slice. */
    refresh?: boolean;
    /** Caller should open the conflict diff (server_row vs. local state). */
    showDiff?: boolean;
}

/**
 * Map a gateway result to a UX intent.
 *
 * - APPLIED / IDEMPOTENT_REPLAY → silent success (no toast; the optimistic
 *   update already reflects the change).
 * - WRITE_REJECTED              → passed the guards but no mutation happened
 *   (window closed / not-yet-ported / bad payload); version unchanged, refresh.
 * - VERSION_CONFLICT            → another manager edited first; prompt + diff.
 * - ILLEGAL_TRANSITION          → the shift moved on; the attempted op is stale.
 * - GONE                        → the shift was deleted out from under us.
 * - FORBIDDEN                   → authorization failure.
 * - ERROR                       → transport/server error; surface `error`.
 */
export function mapShiftOpResultToUx(r: ShiftOpResult): ShiftOpUx {
    switch (r.code) {
        case 'APPLIED':
        case 'IDEMPOTENT_REPLAY':
            // Subtle/no toast — the optimistic UI already shows the result.
            return { kind: 'success' };

        case 'WRITE_REJECTED':
            return {
                kind: 'rejected',
                toast: writeRejectedToast(r.note),
                // No version advanced, but the local row may be stale relative to
                // the (unchanged) server row — a refresh keeps the UI honest.
                refresh: true,
            };

        case 'VERSION_CONFLICT':
            return {
                kind: 'conflict',
                toast: 'This shift was changed by another manager.',
                refresh: true,
                showDiff: true,
            };

        case 'ILLEGAL_TRANSITION':
            return {
                kind: 'illegal',
                toast: `This shift is now ${r.current_state}; ${r.attempted} no longer applies.`,
                refresh: true,
            };

        case 'GONE':
            return {
                kind: 'gone',
                toast: 'This shift was deleted by another manager.',
                refresh: true,
            };

        case 'FORBIDDEN':
            return { kind: 'forbidden', toast: 'Not authorized.' };

        case 'AUTO_OWNER_ACTIVE':
            return {
                kind: 'auto_owned',
                toast: 'AutoPilot is resolving this — try again shortly.',
                refresh: true,
            };

        case 'ERROR':
        default:
            return { kind: 'error', toast: r.error ?? 'Something went wrong.' };
    }
}

/** Human-readable copy for the machine-readable `WRITE_REJECTED` notes. */
function writeRejectedToast(note?: string): string {
    switch (note) {
        case 'PUBLISH_TOO_LATE':
            return 'Too late to publish — the shift is within its 4-hour lock.';
        case 'MISSING_WINNER_ID':
            return 'No bid winner was specified.';
        case 'MISSING_EMPLOYEE_ID':
            return 'No employee was specified.';
        case 'NOT_IMPLEMENTED':
            return 'This action is not available yet.';
        default:
            return 'That action could not be applied.';
    }
}
