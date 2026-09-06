/**
 * Baseline FT — admitting candidates one at a time.
 *
 * WHY ONE AT A TIME. Rest gaps, the 20-in-28 density cap and the paired
 * days-off pattern are properties of a SET of shifts, not of any single shift.
 * Validating every candidate independently against the pre-existing roster
 * would let two candidates on consecutive days each pass a ten-hour rest check
 * on their own and fail together once both were written. Each candidate is
 * therefore judged against the roster PLUS everything already admitted in this
 * run, in a fixed order, so the set that comes out is one the engine has
 * actually approved as a set.
 *
 * WHY NEW VIOLATIONS ONLY. The V8 engine reports on the whole schedule it is
 * given, so an employee who is already in breach would make every candidate
 * look blocking — including candidates that have nothing to do with the breach.
 * Admission therefore compares each trial against the state before it and
 * rejects a candidate only for violations IT introduces. A pre-existing problem
 * is surfaced separately by the requirement calculator; it is not this module's
 * job to punish a new shift for an old fault.
 *
 * WHY cl 35.1(e) IS TURNED ON HERE. `enforce_ft_days_off` defaults to FALSE in
 * `DEFAULT_V8_CONFIG`, so the paired-days-off rule is inert everywhere else in
 * the product. A generator that lays down a full-time employee's whole month
 * is precisely where that pattern has to be checked, so this module enables it
 * explicitly rather than relying on a default it does not own.
 */

import { V8Engine } from '@/modules/compliance/v8/engine';
import type { V8Employee, V8Shift, V8Hit } from '@/modules/compliance/v8/types';
import {
    evaluateShiftAvailabilityFromSlots,
    type AvailabilityMode,
    type DeclaredSlot,
} from '@/modules/rosters/domain/availability-check';
import type { Candidate, ExistingShift, Finding } from './types';

export interface AdmissionInput {
    /** Ordered candidates from `generateCandidates`. Order is preserved. */
    candidates: readonly Candidate[];
    /** The V8 employee record. `contract_type` must already be resolved to FT. */
    employee: V8Employee;
    /** EVERY existing shift for this employee, any sub-department. */
    existingShifts: readonly ExistingShift[];
    /** Declared availability slots. Empty for full-timers, by design. */
    availabilitySlots: readonly DeclaredSlot[];
    /** 'OPT_OUT' for FT/PT — silence means available by contract. */
    availabilityMode: AvailabilityMode;
    /**
     * Reference date for rule evaluation, `yyyy-MM-dd`.
     *
     * REQUIRED, though `V8Engine.evaluate` would default it to today. A default
     * that reads the clock would make this function's output depend on when it
     * ran, which is exactly the property the idempotency guarantee forbids.
     */
    referenceDate: string;
    /** Overrides on top of the baseline config. Rarely needed. */
    configOverride?: Record<string, unknown>;
}

export interface AdmissionResult {
    admitted: Candidate[];
    rejected: Array<{ candidate: Candidate; reasons: Finding[] }>;
    /** Non-blocking findings carried forward for the review screen. */
    warnings: Finding[];
}

/**
 * Identity of a violation, used to tell a NEW breach from a pre-existing one.
 *
 * Includes the affected shifts, not just the rule id. A rest-gap breach between
 * shifts A and B is a different fact from one between B and C, and collapsing
 * them to `V8_MIN_REST_GAP` would let the second through on the strength of the
 * first. For aggregate rules the affected set grows when a shift is added, so
 * the signature changes and the candidate is correctly held responsible.
 */
function signature(hit: V8Hit): string {
    return `${hit.rule_id}|${[...(hit.affected_shifts ?? [])].sort().join(',')}`;
}

function toV8Shift(s: ExistingShift): V8Shift {
    return {
        id: s.id,
        date: s.date,
        shift_date: s.date,
        start_time: s.startTime,
        end_time: s.endTime,
        // Every rostered hour counts as ordinary here; the run states that
        // axiom explicitly rather than letting it be inferred. The ordinary/
        // overtime split is payroll's, computed from hours actually worked.
        sub_department_id: s.subDepartmentId,
        target_employment_type: 'FT',
    };
}

function candidateToV8Shift(c: Candidate): V8Shift {
    return {
        // The idempotency key doubles as a stable synthetic id, so a hit that
        // names this shift can be matched back to the candidate that caused it.
        id: c.idempotencyKey,
        date: c.shiftDate,
        shift_date: c.shiftDate,
        start_time: c.startTime,
        end_time: c.endTime,
        unpaid_break_minutes: c.unpaidBreakMinutes,
        paid_break_minutes: c.paidBreakMinutes,
        role_id: c.roleId,
        target_employment_type: 'FT',
        is_candidate: true,
    };
}

/** Turn a V8 hit into a finding a manager can read without knowing the engine. */
function toFinding(hit: V8Hit, candidate: Candidate): Finding {
    return {
        severity: hit.blocking ? 'BLOCKING' : 'WARNING',
        code: hit.rule_id,
        plain: `${candidate.shiftDate}: ${hit.summary}.`,
        clause: extractClause(hit.details ?? ''),
        overridable: !hit.blocking,
        employeeId: candidate.employeeId,
        candidateKey: candidate.idempotencyKey,
        calculation: hit.calculation,
    };
}

function extractClause(details: string): string | undefined {
    const m = details.match(/(ICC EBA )?(cl\.?\s?[\d.]+[a-z()]*|Schedule\s?\d[^).]*)/i);
    return m ? `ICC EBA ${m[2]}`.replace(/\s+/g, ' ').trim() : undefined;
}

export function admitCandidates(input: AdmissionInput): AdmissionResult {
    const {
        candidates, employee, existingShifts, availabilitySlots,
        availabilityMode, referenceDate, configOverride = {},
    } = input;

    const engine = new V8Engine({
        // cl 35.1(e), second limb — inert by default across the product.
        enforce_ft_days_off: true,
        // cl 40.1. The eight-hour reduction in cl 40.2 needs a written mutual
        // agreement that nothing in the schema records, so it is never applied
        // here — a config-level relaxation would grant it to a whole run rather
        // than to the individuals who actually signed one.
        min_rest_gap_minutes: 600,
        ...configOverride,
    } as never);

    const admitted: Candidate[] = [];
    const rejected: AdmissionResult['rejected'] = [];
    const warnings: Finding[] = [];

    let currentShifts: V8Shift[] = existingShifts.map(toV8Shift);
    let currentBlocking = new Set(
        engine.evaluate(employee, currentShifts, referenceDate)
            .hits.filter(h => h.blocking).map(signature),
    );

    for (const candidate of candidates) {
        const reasons: Finding[] = [];

        // ── Availability ────────────────────────────────────────────────────
        //
        // For a full-timer this resolves to `contract_available`: they hold no
        // declared slots (migration 20260817120000 removed them) and OPT_OUT
        // reads silence as available by contract. An EXPLICIT marker is a
        // positive statement of unavailability and still binds, which is why
        // the check runs rather than being skipped for FT.
        const avail = evaluateShiftAvailabilityFromSlots(
            availabilitySlots as DeclaredSlot[],
            candidate.shiftDate,
            candidate.startTime,
            candidate.endTime,
            availabilityMode,
        );
        if (avail.verdict === 'outside_window') {
            reasons.push({
                severity: 'BLOCKING',
                code: 'BFT_UNAVAILABLE',
                plain: `${candidate.shiftDate}: ${avail.message}`,
                overridable: false,
                employeeId: candidate.employeeId,
                candidateKey: candidate.idempotencyKey,
            });
        }

        // ── Compliance, against the accumulating set ────────────────────────
        const trial = [...currentShifts, candidateToV8Shift(candidate)];
        const result = engine.evaluate(employee, trial, referenceDate);

        const introduced = result.hits.filter(h => !currentBlocking.has(signature(h)));
        for (const hit of introduced) {
            if (hit.blocking) reasons.push(toFinding(hit, candidate));
        }

        if (reasons.length > 0) {
            rejected.push({ candidate, reasons });
            continue;                                   // state unchanged
        }

        // Accepted. Non-blocking findings introduced by this candidate travel
        // with the proposal so the review screen can show, for example, that
        // admitting this shift is what cost the employee their second
        // consecutive day off.
        for (const hit of introduced) {
            if (!hit.blocking) warnings.push(toFinding(hit, candidate));
        }

        admitted.push(candidate);
        currentShifts = trial;
        currentBlocking = new Set(
            result.hits.filter(h => h.blocking).map(signature),
        );
    }

    return { admitted, rejected, warnings };
}
