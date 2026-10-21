/**
 * Writes that must say when nothing changed.
 *
 * Row-level security refuses an UPDATE or DELETE silently: PostgREST answers
 * success and changes no rows. So a write aimed at a particular record — approve
 * this timesheet, revoke this certificate — reads as done when the caller was not
 * allowed to do it, or the record had already gone. Ask for the count and pass the
 * result here; a write that touched nothing becomes a PERMISSION_DENIED AppError,
 * the same error a refusing RPC raises, so callers' existing error handling and
 * toasts show it.
 *
 *     const res = await supabase.from('timesheets')
 *         .update(patch, { count: 'exact' }).eq('id', id);
 *     if (res.error) throw res.error;
 *     assertWrote(res, 'approve this timesheet');
 *
 * Not for bulk or idempotent writes ("mark everything read", "clear the old rows
 * then insert"), where touching nothing is a normal outcome.
 */
import { AppError } from './rpc/errors';

export class WriteRefusedError extends AppError {
    constructor(action: string) {
        super({
            code: 'PERMISSION_DENIED',
            message: `Nothing changed: you can't ${action}, or it no longer exists. Refresh and try again.`,
            details: { action },
        });
        this.name = 'WriteRefusedError';
    }
}

export interface WriteResult {
    error: unknown;
    /** Present when the write asked for `{ count: 'exact' }`. */
    count?: number | null;
    /** Present when the write chained `.select(...)`. */
    data?: unknown;
}

/**
 * Throw WriteRefusedError when a write reports that it touched no rows.
 *
 * Leaves errored results to the caller, and stays silent when the result carries
 * neither a count nor returned rows — it cannot tell, so it does not guess.
 */
export function assertWrote(result: WriteResult, action: string): void {
    if (result.error) return;
    const rows =
        typeof result.count === 'number' ? result.count
        : Array.isArray(result.data) ? result.data.length
        : undefined;
    if (rows === 0) throw new WriteRefusedError(action);
}
