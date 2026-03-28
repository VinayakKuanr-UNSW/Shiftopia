/**
 * R_AVAILABILITY_MATCH — Availability Advisory Rule (Bucket A)
 *
 * Evaluates TWO things per candidate shift:
 *   1. Locked availability — does the candidate time overlap an assigned shift?
 *   2. Declared availability — is the time covered by the employee's declared slots?
 *
 * IMPORTANT CONSTRAINTS:
 *   - This rule is NEVER BLOCKING inside the compliance engine.
 *   - It always emits WARNING (never BLOCKING), regardless of outcome.
 *   - Enforcement (blocking) happens OUTSIDE the engine via isEligible().
 *   - Bidding and Trading: rule still evaluates and returns advisory result;
 *     it is the caller's responsibility NOT to enforce it.
 *
 * Status logic (per spec §5):
 *   FAIL (overlap)         → status: "FAIL", conflictType: "LOCKED"
 *   WARN (not declared)    → status: "WARN", conflictType: "NOT_DECLARED"
 *   PASS                   → no hit emitted
 *
 * The rule is SKIPPED ENTIRELY if ctx.availability_data is not provided.
 * This ensures backward compatibility for callers that don't supply availability data.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';

// ── Time math ──────────────────────────────────────────────────────────────────

const toMinutes = (t: string): number => {
    const p = t.split(':').map(Number);
    return p[0] * 60 + (p[1] ?? 0);
};

const overlaps = (
    aStart: string, aEnd: string,
    bStart: string, bEnd: string
): boolean => {
    const as = toMinutes(aStart), ae = toMinutes(aEnd);
    const bs = toMinutes(bStart), be = toMinutes(bEnd);
    return as < be && bs < ae;    // end-exclusive
};

const isCovered = (
    candStart: string,
    candEnd:   string,
    slots: Array<{ start_time: string; end_time: string }>
): boolean => {
    const cStart = toMinutes(candStart);
    const cEnd   = toMinutes(candEnd);

    const sorted = [...slots].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    let coveredUntil = cStart;

    for (const s of sorted) {
        const ss = toMinutes(s.start_time);
        const se = toMinutes(s.end_time);
        if (ss > coveredUntil) break;
        if (se > coveredUntil) coveredUntil = se;
        if (coveredUntil >= cEnd) return true;
    }
    return coveredUntil >= cEnd;
};

// ── Rule evaluator ─────────────────────────────────────────────────────────────

export const R_AVAILABILITY_MATCH: RuleEvaluatorV2 = (ctx) => {
    // Skip entirely if caller did not provide availability data
    if (!ctx.availability_data) return [];

    const { declared_slots, assigned_shifts } = ctx.availability_data;
    const hits: RuleHitV2[] = [];

    for (const shift of ctx.candidate_shifts) {
        const { shift_id, shift_date, start_time, end_time } = shift;

        // ── Check 1: overlap with locked (assigned) shifts ─────────────────────
        const dayAssigned = assigned_shifts.filter(s => s.shift_date === shift_date);
        const hasLock = dayAssigned.some(s =>
            overlaps(start_time, end_time, s.start_time, s.end_time)
        );

        if (hasLock) {
            hits.push({
                rule_id:         'R_AVAILABILITY_MATCH',
                severity:        'WARNING',    // NEVER BLOCKING — advisory only
                message:
                    `Conflicts with an already-assigned shift on ${shift_date} `
                    + `(${start_time}–${end_time}). This time slot is locked.`,
                resolution_hint:
                    'Cancel or drop the existing assigned shift before assigning this slot, '
                    + 'or choose a different employee or time.',
                affected_shifts: [shift_id],
            });
            continue;    // LOCKED is worse than NOT_DECLARED; no need to check further
        }

        // ── Check 2: declared availability coverage ────────────────────────────
        const daySlots = declared_slots.filter(s => s.slot_date === shift_date);
        const declared = daySlots.length > 0 && isCovered(start_time, end_time, daySlots);

        if (!declared) {
            hits.push({
                rule_id:         'R_AVAILABILITY_MATCH',
                severity:        'WARNING',    // NEVER BLOCKING — advisory only
                message:
                    `Employee has not declared availability for ${shift_date} `
                    + `${start_time}–${end_time}.`,
                resolution_hint:
                    'Ask the employee to update their availability in MyAvailability, '
                    + 'or select a different employee.',
                affected_shifts: [shift_id],
            });
        }
        // If declared && no lock → PASS; no hit emitted
    }

    return hits;
};
