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
 */

import { supabase } from '@/platform/supabase/client';
import {
    evaluateShiftShape,
    type ShapeEmploymentTarget,
    type ShapeResult,
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

export interface ShapeGateOptions {
    /**
     * Named, reasoned bypass. Present ⇒ a blocking shape is recorded and allowed
     * through; absent ⇒ it throws.
     *
     * A string rather than a boolean, and a string rather than an inference from
     * `creation_source`, because a bypass keyed off some other field is exactly
     * the implicit coupling this consolidation exists to remove. If a caller
     * needs out, it says so and says why, in the code, where a reader will find
     * it.
     *
     * There is currently one legitimate user: the demand synthesiser, whose
     * output is a coverage skeleton with no breaks modelled at all. It inserts
     * blocking shifts as Draft ON PURPOSE so a manager can complete them.
     */
    exemptReason?: string;
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

    if (options.exemptReason) {
        console.warn(
            `[shape-gate] blocking shape allowed through — ${options.exemptReason}:`,
            result.hits.filter(h => h.blocking).map(h => h.rule_id).join(', '),
        );
        return result;
    }

    throw new ComplianceError(
        result.hits.filter(h => h.blocking).map(h => h.details),
        options.rpcName,
    );
}
