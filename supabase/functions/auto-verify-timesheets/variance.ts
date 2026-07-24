// =============================================================================
// variance.ts — PURE zero-variance decision core for timesheet auto-verify.
//
// No Deno/DB globals: takes plain numbers/strings, returns a decision. Unit-
// tested via the colocated vitest config. The worker (index.ts) maps DB rows to
// TimesheetEvalInput and hands the decision to sm_timesheet_auto_decide.
//
// RULE — "zero-variance clean punches" (fixed, not configurable):
//   AUTO_APPROVE only when the shift is at a terminal attendance state, BOTH
//   actual clock instants exist, there are NO manual billable edits, and both
//   the clock-in and clock-out land within ±7.5 min of schedule. When approved,
//   the commit RPC floors/ceils billable to the exact scheduled shift — which is
//   *why* a within-tolerance punch is safe to auto-approve. Everything else ->
//   MANUAL_REVIEW. Timesheets are never auto-rejected (a human judgement).
//   Overtime is not evaluated: a late clock-out beyond +7.5m already fails the
//   tolerance bound and routes to a manager.
// =============================================================================

/** Fixed punch tolerance in minutes (not org-configurable). */
export const PUNCH_TOLERANCE_MIN = 7.5;

export type TimesheetDecisionKind = 'AUTO_APPROVE' | 'MANUAL_REVIEW';

export interface TimesheetEvalInput {
    attendanceStatus: string | null;
    timesheetStatus: string | null;
    /** true when a manager has set a billable start/end on the timesheet row */
    hasManualEdit: boolean;
    /** absolute instants (epoch ms) or null when unknown */
    scheduledStartMs: number | null;
    scheduledEndMs: number | null;
    actualStartMs: number | null;
    actualEndMs: number | null;
    /** tolerance override for tests; defaults to PUNCH_TOLERANCE_MIN */
    toleranceMinutes?: number;
}

export interface TimesheetEvalResult {
    decision: TimesheetDecisionKind;
    reason: string;
    varianceInMin: number | null;
    varianceOutMin: number | null;
    /** true when the row is already settled by a human and should be skipped */
    alreadyFinal: boolean;
}

const minutesBetween = (a: number, b: number): number => Math.round((a - b) / 60000);

export function evaluateTimesheet(input: TimesheetEvalInput): TimesheetEvalResult {
    const status = (input.timesheetStatus ?? '').toLowerCase();

    // Already decided by a human (or terminal) — nothing to auto-verify.
    if (status === 'approved' || status === 'rejected' || status === 'no_show') {
        return { decision: 'MANUAL_REVIEW', reason: `Already ${status}`, varianceInMin: null, varianceOutMin: null, alreadyFinal: true };
    }

    // No-shows and forced auto clock-outs are always a manager call.
    const attendance = (input.attendanceStatus ?? '').toLowerCase();
    if (attendance === 'no_show') {
        return { decision: 'MANUAL_REVIEW', reason: 'No-show — needs a manager', varianceInMin: null, varianceOutMin: null, alreadyFinal: false };
    }
    if (attendance === 'auto_clock_out') {
        return { decision: 'MANUAL_REVIEW', reason: 'Auto clock-out — missing real clock-out', varianceInMin: null, varianceOutMin: null, alreadyFinal: false };
    }

    // Zero-variance means the raw punches stand as-is: a manager edit disqualifies.
    if (input.hasManualEdit) {
        return { decision: 'MANUAL_REVIEW', reason: 'Has manual billable edits', varianceInMin: null, varianceOutMin: null, alreadyFinal: false };
    }

    // Need both scheduled instants and both actual instants to compare.
    if (input.scheduledStartMs == null || input.scheduledEndMs == null) {
        return { decision: 'MANUAL_REVIEW', reason: 'Missing scheduled times', varianceInMin: null, varianceOutMin: null, alreadyFinal: false };
    }
    if (input.actualStartMs == null || input.actualEndMs == null) {
        const which = input.actualStartMs == null ? 'clock-in' : 'clock-out';
        return { decision: 'MANUAL_REVIEW', reason: `Missing ${which}`, varianceInMin: null, varianceOutMin: null, alreadyFinal: false };
    }

    const varIn = minutesBetween(input.actualStartMs, input.scheduledStartMs);
    const varOut = minutesBetween(input.actualEndMs, input.scheduledEndMs);
    const tol = Math.max(0, input.toleranceMinutes ?? PUNCH_TOLERANCE_MIN);

    if (Math.abs(varIn) > tol) {
        return { decision: 'MANUAL_REVIEW', reason: `Clock-in variance ${varIn >= 0 ? '+' : ''}${varIn}m exceeds ±${tol}m`, varianceInMin: varIn, varianceOutMin: varOut, alreadyFinal: false };
    }
    if (Math.abs(varOut) > tol) {
        return { decision: 'MANUAL_REVIEW', reason: `Clock-out variance ${varOut >= 0 ? '+' : ''}${varOut}m exceeds ±${tol}m`, varianceInMin: varIn, varianceOutMin: varOut, alreadyFinal: false };
    }

    return {
        decision: 'AUTO_APPROVE',
        reason: `Clean punches (in ${varIn >= 0 ? '+' : ''}${varIn}m / out ${varOut >= 0 ? '+' : ''}${varOut}m, within ±${tol}m)`,
        varianceInMin: varIn,
        varianceOutMin: varOut,
        alreadyFinal: false,
    };
}

/**
 * Fixed, non-configurable off-office window: AutoPilot drains only between
 * 18:00 and 06:00 Australia/Sydney (DST-safe via the named zone). During office
 * hours (06:00–18:00) the worker stays dormant and completed shifts wait for a
 * manager. Mirrors the DB gate `is_timesheet_autopilot_active`.
 */
export function isWithinAutopilotWindow(evalDate: Date = new Date()): boolean {
    try {
        const hourStr = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Australia/Sydney',
            hour: '2-digit',
            hour12: false,
        }).formatToParts(evalDate).find((p) => p.type === 'hour')?.value ?? '00';
        // 'en-GB' can render midnight as "24"; normalise to 0.
        const hour = Number(hourStr) % 24;
        return hour >= 18 || hour < 6;
    } catch {
        // Fail closed: if the zone can't be resolved, don't auto-act.
        return false;
    }
}

