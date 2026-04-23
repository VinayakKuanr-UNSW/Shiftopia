/**
 * Compliance Engine v2 — Context-Aware Eligibility Gate
 *
 * isEligible() enforces availability_match OUTSIDE the compliance engine.
 * The engine itself never blocks on availability (always WARNING); this function
 * translates the advisory result into an actionable gate per assignment context.
 *
 * Rules (per spec):
 *   MANUAL / AUTO  → enforce: reject if availability_match.status !== 'PASS'
 *   BID / TRADE    → advisory: availability_match is surfaced in UI but never blocks
 *
 * Always enforced (all contexts):
 *   - BLOCKING rule hits from the engine (overlap, quals, daily hours, etc.)
 */

import { ComplianceResultV2, AvailabilityMatchSummary, AvailabilityDataV2, ShiftV2 } from './types';
import { R_AVAILABILITY_MATCH } from './rules/R_AVAILABILITY_MATCH';
import { AssignmentContext } from '@/modules/rosters/domain/commands/assignShift.command';

// =============================================================================
// TYPES
// =============================================================================

export interface EligibilityResult {
    /** true = assignment may proceed */
    eligible: boolean;
    /**
     * Human-readable rejection reason(s).
     * Empty when eligible = true.
     */
    reasons: string[];
    /**
     * Advisory notes that do not block the assignment.
     * Present when eligible = true but there are soft warnings.
     */
    advisories: string[];
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Determine whether an employee is eligible for assignment given compliance
 * results and the assignment context.
 *
 * @param result   Full compliance result from evaluateCompliance()
 * @param context  Assignment context (MANUAL | AUTO | BID | TRADE)
 */
export function isEligible(
    result:  ComplianceResultV2,
    context: AssignmentContext,
): EligibilityResult {
    const reasons:    string[] = [];
    const advisories: string[] = [];

    // ── 1. Hard compliance blocks (always enforced) ─────────────────────────
    const blockingHits = result.rule_hits.filter(h => h.severity === 'BLOCKING');
    for (const hit of blockingHits) {
        reasons.push(hit.message);
    }

    // ── 2. Availability match (context-aware) ───────────────────────────────
    const avMatch: AvailabilityMatchSummary | null | undefined = result.availability_match;

    if (avMatch !== null && avMatch !== undefined) {
        const enforce = context === 'MANUAL' || context === 'AUTO';

        if (avMatch.status !== 'PASS') {
            const label = availabilityStatusLabel(avMatch);

            if (avMatch.status === 'FAIL' && enforce) {
                // FAIL (Overlap) blocks ONLY for MANUAL/AUTO
                reasons.push(label);
            } else {
                // Surface as advisory in bidding/trading or if just a WARN
                advisories.push(label);
            }
        }
    }

    return {
        eligible:   reasons.length === 0,
        reasons,
        advisories,
    };
}

// =============================================================================
// LIGHTWEIGHT VARIANT — for command layer (no full compliance eval required)
// =============================================================================

/**
 * Run ONLY the R_AVAILABILITY_MATCH rule for a single candidate shift.
 *
 * Use this in the assignment command layer when you already have the
 * availability data but don't need (or can't afford) a full compliance eval.
 *
 * Internally builds a minimal RuleContextV2 stub with only the fields
 * that R_AVAILABILITY_MATCH reads.
 *
 * @param candidateShift  The shift being proposed for assignment
 * @param availabilityData Pre-fetched declared slots + locked intervals
 * @param context          Assignment context for enforcement gating
 */
export function checkAvailabilityOnly(
    candidateShift:  ShiftV2,
    availabilityData: AvailabilityDataV2,
    context:         AssignmentContext,
): EligibilityResult {
    // Build a minimal context stub — R_AVAILABILITY_MATCH only reads
    // ctx.availability_data and ctx.candidate_shifts
    const stubCtx = {
        availability_data: availabilityData,
        candidate_shifts:  [candidateShift],
    } as Parameters<typeof R_AVAILABILITY_MATCH>[0];

    const hits = R_AVAILABILITY_MATCH(stubCtx);

    if (hits.length === 0) {
        return { eligible: true, reasons: [], advisories: [] };
    }

    const lockedHits   = hits.filter(h => h.message.includes('locked'));
    const notDeclHits  = hits.filter(h => !h.message.includes('locked'));
    const hasLock      = lockedHits.length > 0;

    const enforce = context === 'MANUAL' || context === 'AUTO';
    const reasons:    string[] = [];
    const advisories: string[] = [];

    if (hasLock && enforce) {
        const msg = 'Employee already has an assigned shift during this time (time slot is locked).';
        reasons.push(msg);
    } else if (hasLock && !enforce) {
        const msg = 'Employee already has an assigned shift during this time (time slot is locked).';
        advisories.push(msg);
    } else if (notDeclHits.length > 0) {
        const msg = 'Employee has not declared availability for this shift time.';
        advisories.push(msg);
    }

    return {
        eligible:   reasons.length === 0,
        reasons,
        advisories,
    };
}

// =============================================================================
// HELPERS
// =============================================================================

function availabilityStatusLabel(match: AvailabilityMatchSummary): string {
    switch (match.status) {
        case 'FAIL':
            return 'Employee already has an assigned shift during this time (time slot is locked).';
        case 'WARN':
            return 'Employee has not declared availability for this shift time.';
        default:
            return 'Availability check failed.';
    }
}
