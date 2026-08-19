/**
 * Shift Shape Gate — the enforcement point for Layer 1 compliance.
 *
 * WHY THIS EXISTS. `@/modules/compliance/shape` decides whether a shift's shape
 * is lawful, but deciding is not enforcing. Until now the layer had exactly two
 * callers — the Add Shift modal and the demand synthesiser — so a shift created
 * any other way was never shape-checked at all: the DnD quick-add, the Group
 * Mode inline create, the Labor Demand page, anything reaching
 * `shiftsCommands.createShift` directly. Those paths could write a 90-minute
 * casual engagement or a 9-hour shift with no meal break, and nothing objected,
 * because the only thing standing between them and the table was a modal they
 * never opened.
 *
 * A rule enforced by one form is a rule enforced by nobody. So the gate moves
 * down to `shiftsCommands`, which every client-side write already funnels
 * through, and runs unconditionally. There is no employee lookup and no network
 * call in the evaluation itself — shape is decidable from the shift alone — so
 * making it universal costs nothing.
 *
 * WHAT IT DOES NOT COVER. `apply_template_to_date_range_v2` stamps shifts
 * server-side from `template_shifts`, so those rows never pass through here.
 * That path is covered upstream instead: a template shift has the same intrinsic
 * fields as a real one, so validating at template AUTHORING time means template
 * application cannot produce a shape that was not already checked. A DB CHECK
 * constraint would be the belt to this braces, and is deliberately left as a
 * backstop rather than the primary guarantee — a constraint can only reject, it
 * cannot tell the manager which clause they breached or offer the fix.
 *
 * THE DATE IS AN INPUT, NOT A CONSTANT (2026-08-19).
 * Two of these rules — cl 56.2's public-holiday minimum and the Sunday tier of
 * cl 12.4(c)/12.5(c) — are decided by WHICH DAY the shift falls on. Placing the
 * gate only on create/edit quietly assumed a shift's date never changes after
 * it is written, and three paths broke that assumption: `sm_move_shift` re-dates
 * a row without going through `updateShift` at all, and the assign command both
 * re-dates via that RPC and writes `start_time`/`end_time` with a raw table
 * update. A lawful three-hour Monday casual dragged onto Christmas Day became
 * unlawful with nothing objecting.
 *
 * `assertShapeForShiftId` below is the answer: it takes the id of a row that
 * already exists, loads it, merges the pending change, and judges the RESULT.
 * Any caller that moves a shift in time can therefore be gated without first
 * being refactored to route through `updateShift`.
 */

import { supabase } from '@/platform/supabase/client';
import {
    evaluateShiftShape,
    type ShapeEmploymentTarget,
    type ShapeResult,
    type ShapeRuleId,
} from '@/modules/compliance/shape';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { ComplianceError } from '@/platform/supabase/rpc/errors';

/* ────────────────────────────────────────────────────────────────────────────
   Security role resolution
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cached set of Security role ids.
 *
 * Schedule 3 changes what a lawful shape IS — the meal break is paid, so net
 * length equals gross and the requirement is satisfied from `paid_break_minutes`
 * rather than `unpaid_break_minutes`. Without this the gate would read a
 * compliant security shift (30m paid, 0m unpaid) as having no meal break at all
 * and refuse to save it. The flag is therefore not optional decoration; it is
 * load-bearing for correctness in both directions.
 *
 * Cached as a PROMISE, not a value, so twenty concurrent `createShift` calls
 * from the synthesiser's chunked insert share one request instead of racing
 * twenty. 24 of 200 production roles match, so the payload is small.
 */
let securityRoleIdsPromise: Promise<ReadonlySet<string>> | null = null;

async function fetchSecurityRoleIds(): Promise<ReadonlySet<string>> {
    const { data, error } = await supabase.from('roles').select('id, name');
    // Reject rather than returning an empty set, so the caching layer below can
    // tell a genuine "no security roles exist" from "the lookup failed". Those
    // are the same VALUE and must not be the same OUTCOME.
    if (error) throw error;

    const ids = new Set<string>();
    for (const r of data ?? []) {
        if (r?.id && isSecurityRoleName(r.name)) ids.add(r.id);
    }
    return ids;
}

function securityRoleIds(): Promise<ReadonlySet<string>> {
    if (!securityRoleIdsPromise) {
        securityRoleIdsPromise = fetchSecurityRoleIds().catch(error => {
            // NEVER cache a failure. Swallowing the error inside the fetch and
            // caching the empty set it returned would let one transient network
            // blip disable Schedule 3 for the rest of the session — every
            // security shift refused, with a cl 36.1 message about a meal break
            // that is in fact correctly allotted, until someone reloads the tab.
            // Clearing the slot means the next save retries.
            securityRoleIdsPromise = null;

            // Fail OPEN for this one call, and stricter: security shifts are
            // judged by the general rules, so the failure mode is a visible
            // refusal the manager can retry, never a silent pass.
            console.warn('[shape-gate] could not resolve Security roles; Schedule 3 not applied', error);
            return new Set<string>();
        });
    }
    return securityRoleIdsPromise;
}

/** Test seam. Also the hook a roles-admin screen would call after renaming a role. */
export function resetSecurityRoleCache(): void {
    securityRoleIdsPromise = null;
}

/* ────────────────────────────────────────────────────────────────────────────
   The gate
   ──────────────────────────────────────────────────────────────────────────── */

/** The intrinsic fields of a shift row, however it is spelled by the caller. */
export interface ShapeGateInput {
    shift_date:              string;
    start_time:              string;
    end_time:                string;
    unpaid_break_minutes?:   number | null;
    paid_break_minutes?:     number | null;
    is_training?:            boolean | null;
    target_employment_type?: string | null;
    target_requires_flexible?: boolean | null;
    role_id?:                string | null;
    /** Skips the role lookup when the caller already knows (the edit path reads `shift.roles`). */
    role_name?:              string | null;
}

/**
 * A null `target_employment_type` means "any employment type may fill this".
 *
 * Defaulting to `'Casual'` is not a guess about who will work it — it is parity
 * with the Add Shift modal, which has always defaulted the same way. A gate that
 * chose a different default from the form it guards would produce the one
 * outcome worse than no gate: the form says the shift is fine and the save
 * throws.
 */
const UNTARGETED_DEFAULT: ShapeEmploymentTarget = 'Casual';

function normaliseTarget(value: string | null | undefined): ShapeEmploymentTarget {
    return value === 'FT' || value === 'PT' || value === 'Casual' ? value : UNTARGETED_DEFAULT;
}

/** Evaluate a row's shape, resolving Schedule 3 from the role. Never throws. */
export async function evaluateShapeForRow(input: ShapeGateInput): Promise<ShapeResult> {
    let isSecurity: boolean;
    if (input.role_name !== undefined && input.role_name !== null) {
        isSecurity = isSecurityRoleName(input.role_name);
    } else if (input.role_id) {
        isSecurity = (await securityRoleIds()).has(input.role_id);
    } else {
        isSecurity = false;
    }

    return evaluateShiftShape({
        shift_date:             input.shift_date,
        start_time:             input.start_time,
        end_time:               input.end_time,
        unpaid_break_minutes:   input.unpaid_break_minutes ?? 0,
        paid_break_minutes:     input.paid_break_minutes ?? 0,
        is_training:            input.is_training ?? false,
        target_employment_type: normaliseTarget(input.target_employment_type),
        target_requires_flexible: input.target_requires_flexible ?? false,
        is_security:            isSecurity,
    });
}

/**
 * A named, reasoned, RULE-SCOPED bypass.
 *
 * This used to be a bare `exemptReason: string` that waived every blocking rule
 * at once. It had exactly one user — the demand synthesiser, whose output is a
 * coverage skeleton with no breaks modelled — and the reason it gave said so:
 * "breaks are filled in by the manager". But a blanket waiver does not mean what
 * its reason says. It also waived `SHAPE_MIN_ENGAGEMENT_PH`, so the synthesiser
 * could mint a two-hour casual shift on Christmas Day and the audit trail would
 * explain it as a missing meal break.
 *
 * Naming the rules makes the waiver as narrow as its justification, and makes
 * the next one impossible to widen by accident: a rule the caller did not list
 * still blocks.
 */
export interface ShapeExemption {
    /** Exactly the rules this caller may breach. Anything else still throws. */
    rules:  readonly ShapeRuleId[];
    /** Why — recorded in the warning, read by whoever finds the shift later. */
    reason: string;
}

export interface ShapeGateOptions {
    exempt?: ShapeExemption;
    /** Included in the thrown error so the message names the operation. */
    rpcName?: string;
}

/**
 * Evaluate, and throw `ComplianceError` on a blocking shape.
 *
 * Returns the result either way so a caller with an exemption can still record
 * what the shift would have failed. `ComplianceError` is reused rather than a
 * new error type: the UI already renders `code: 'COMPLIANCE'` with the violation
 * list, and shape findings carry the same human-readable summaries.
 */
export async function assertShapeForRow(
    input: ShapeGateInput,
    options: ShapeGateOptions = {},
): Promise<ShapeResult> {
    const result = await evaluateShapeForRow(input);

    if (!result.blocking) return result;

    const blocking = result.hits.filter(h => h.blocking);
    const exempt   = options.exempt;
    // Partition rather than short-circuit: a caller exempt from the meal break
    // must still be refused a two-hour public holiday engagement. Waiving the
    // listed rules is not the same as waiving the call.
    const waived   = exempt ? blocking.filter(h => exempt.rules.includes(h.rule_id)) : [];
    const enforced = exempt ? blocking.filter(h => !exempt.rules.includes(h.rule_id)) : blocking;

    if (waived.length > 0) {
        console.warn(
            `[shape-gate] blocking shape allowed through — ${exempt!.reason}:`,
            waived.map(h => h.rule_id).join(', '),
        );
    }

    if (enforced.length === 0) return result;

    throw new ComplianceError(enforced.map(h => h.details), options.rpcName);
}

/* ────────────────────────────────────────────────────────────────────────────
   Gating a change to a row that already exists
   ──────────────────────────────────────────────────────────────────────────── */

/** The columns a shape verdict needs from a stored shift. */
const SHAPE_COLUMNS =
    'id, shift_date, start_time, end_time, unpaid_break_minutes, paid_break_minutes, ' +
    'is_training, target_employment_type, target_requires_flexible, role_id, roles(name)';

/** The subset of a shift a caller may be changing. Absent ⇒ unchanged. */
export type ShapePatch = Partial<Omit<ShapeGateInput, 'role_name'>>;

/**
 * Judge a shift AFTER a pending change, given only its id.
 *
 * For callers that change one intrinsic field of a stored row without holding
 * the rest of it — `moveShift` knows a date and nothing else, the assign
 * command knows a start and end time. Evaluating the patch alone would be
 * meaningless: a new date says nothing about whether the shift is long enough
 * for that date, which is the entire question a re-date raises.
 *
 * Merged with `!== undefined` rather than object spread, for the reason
 * `updateShift` already documents: a spread copies a key that is
 * present-but-undefined, so `{ target_employment_type: undefined }` would blank
 * an 'FT' target down to the untargeted default and silently relax the 7.6h
 * floor to three hours.
 *
 * A row that cannot be read is NOT a pass. It throws, because the alternative
 * is a gate that opens whenever the network is unreliable.
 */
export async function assertShapeForShiftId(
    shiftId: string,
    patch: ShapePatch,
    options: ShapeGateOptions = {},
): Promise<ShapeResult> {
    const { data, error } = await supabase
        .from('shifts')
        .select(SHAPE_COLUMNS)
        .eq('id', shiftId)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`Shift ${shiftId} could not be read, so its shape cannot be checked.`);

    const current = data as unknown as {
        shift_date: string; start_time: string; end_time: string;
        unpaid_break_minutes: number | null; paid_break_minutes: number | null;
        is_training: boolean | null; target_employment_type: string | null;
        target_requires_flexible: boolean | null; role_id: string | null;
        roles?: { name?: string | null } | null;
    };

    const pick = <K extends keyof ShapePatch & keyof typeof current>(key: K) =>
        (patch[key] !== undefined ? patch[key] : current[key]);

    return assertShapeForRow(
        {
            shift_date:               pick('shift_date') as string,
            start_time:               pick('start_time') as string,
            end_time:                 pick('end_time') as string,
            unpaid_break_minutes:     pick('unpaid_break_minutes') as number | null,
            paid_break_minutes:       pick('paid_break_minutes') as number | null,
            is_training:              pick('is_training') as boolean | null,
            target_employment_type:   pick('target_employment_type') as string | null,
            target_requires_flexible: pick('target_requires_flexible') as boolean | null,
            role_id:                  pick('role_id') as string | null,
            // The joined role travels with the row, so a patch that leaves
            // `role_id` alone needs no second lookup.
            role_name: patch.role_id === undefined ? current.roles?.name ?? null : null,
        },
        options,
    );
}
