import { supabase } from '@/platform/supabase/client';
import { shiftsCommands } from './shifts.commands';
import { shiftsQueries } from './shifts.queries';
import type {
    ShiftOp,
    ShiftOpCode,
    ShiftOpResult,
} from '../domain/shift-ops.contract';

// Re-export domain types
export * from '../domain/shift.entity';

// Re-export DTOs
export * from './shifts.dto';

// Re-export services for direct usage if needed
export { shiftsCommands } from './shifts.commands';
export { shiftsQueries } from './shifts.queries';

// Combined API for backward compatibility with existing code
export const shiftsApi = {
    ...shiftsCommands,
    ...shiftsQueries,
};

// ============================================================
// SHIFT MUTATION GATEWAY (optimistic concurrency)
// ============================================================

/** The set of result codes the RPC can return (kept local for the cast below). */
const SHIFT_OP_CODES: readonly ShiftOpCode[] = [
    'APPLIED',
    'IDEMPOTENT_REPLAY',
    'WRITE_REJECTED',
    'VERSION_CONFLICT',
    'ILLEGAL_TRANSITION',
    'GONE',
    'FORBIDDEN',
    'AUTO_OWNER_ACTIVE',
    'ERROR',
] as const;

/**
 * Apply a single shift mutation through the optimistic-concurrency gateway
 * RPC `sm_apply_shift_op`.
 *
 * The caller passes the shift's CURRENT `version` (read off the `Shift` row).
 * The DB compares it against the live row and either applies the op, replays an
 * idempotent result, or reports a conflict / illegal transition / gone / etc.
 * The returned jsonb is normalized into a `ShiftOpResult` and is NEVER thrown —
 * transport failures are folded into `{ ok:false, code:'ERROR', error }` so call
 * sites have a single, uniform shape to route through `mapShiftOpResultToUx`.
 *
 * Example call site (manager selects a bid winner):
 *
 *   import { applyShiftOp } from '@/modules/rosters/api/shifts.api';
 *   import { mapShiftOpResultToUx } from '@/modules/rosters/domain/shift-ops.contract';
 *
 *   const res = await applyShiftOp({
 *     shiftId:         shift.id,
 *     expectedVersion: shift.version,        // optimistic guard
 *     op:              'select_winner',
 *     payload:         { winner_id: employeeId },
 *   });
 *   const ux = mapShiftOpResultToUx(res);
 *   if (ux.toast) toast(ux.toast);
 *   if (ux.refresh) await refetchShift(shift.id);
 *   if (ux.showDiff) openConflictDiff(res.server_row);
 */
export async function applyShiftOp(args: {
    shiftId: string;
    expectedVersion: number;
    op: ShiftOp;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
}): Promise<ShiftOpResult> {
    const idempotencyKey = args.idempotencyKey ?? crypto.randomUUID();

    try {
        const { data, error } = await supabase.rpc('sm_apply_shift_op', {
            p_shift_id:         args.shiftId,
            p_expected_version: args.expectedVersion,
            p_op:               args.op,
            p_payload:          (args.payload ?? {}) as any,
            p_idempotency_key:  idempotencyKey,
        });

        if (error) {
            return { ok: false, code: 'ERROR', error: error.message };
        }

        // Normalize the returned jsonb into ShiftOpResult. The RPC always returns
        // an object with a `code`; guard against a malformed/unknown payload.
        const raw = (data ?? {}) as Record<string, unknown>;
        const code = SHIFT_OP_CODES.includes(raw.code as ShiftOpCode)
            ? (raw.code as ShiftOpCode)
            : 'ERROR';

        return {
            ok:               raw.ok === true,
            code,
            version:          typeof raw.version === 'number' ? raw.version : undefined,
            state:            typeof raw.state === 'string' ? raw.state : undefined,
            note:             typeof raw.note === 'string' ? raw.note : undefined,
            current_version:  typeof raw.current_version === 'number' ? raw.current_version : undefined,
            current_state:    typeof raw.current_state === 'string' ? raw.current_state : undefined,
            last_modified_by: typeof raw.last_modified_by === 'string' ? raw.last_modified_by : undefined,
            updated_at:       typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
            server_row:       (raw.server_row && typeof raw.server_row === 'object')
                ? (raw.server_row as Record<string, unknown>)
                : undefined,
            attempted:        typeof raw.attempted === 'string' ? raw.attempted : undefined,
            error:            typeof raw.error === 'string' ? raw.error : undefined,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to apply shift operation';
        return { ok: false, code: 'ERROR', error: message };
    }
}
