/**
 * V8 Compliance Engine — Context-Aware Eligibility Gate
 */

import { V8OrchestratorResult, V8OrchestratorShift, V8AvailabilityData } from './types';
import { AssignmentContext } from '@/modules/rosters/domain/commands/assignShift.command';

export interface V8EligibilityResult {
    eligible: boolean;
    reasons: string[];
    advisories: string[];
}

/**
 * Determine whether an employee is eligible for assignment in V8.
 */
export function isV8Eligible(
    result:  V8OrchestratorResult,
    context: AssignmentContext,
): V8EligibilityResult {
    const reasons:    string[] = [];
    const advisories: string[] = [];

    const blockingHits = result.hits.filter(h => h.status === 'BLOCKING');
    for (const hit of blockingHits) {
        reasons.push(hit.summary);
    }

    // Availability is handled as a hit by V8 core
    const availabilityHits = result.hits.filter(h => h.rule_id === 'V8_AVAILABILITY');
    for (const hit of availabilityHits) {
        const enforce = context === 'MANUAL' || context === 'AUTO';
        if (hit.status === 'BLOCKING' && enforce) {
            reasons.push(hit.summary);
        } else {
            advisories.push(hit.summary);
        }
    }

    return {
        eligible:   reasons.length === 0,
        reasons,
        advisories,
    };
}

/**
 * Lightweight V8 availability check.
 */
export function checkV8AvailabilityOnly(
    candidateShift:  V8OrchestratorShift,
    _availabilityData: V8AvailabilityData,
    context:         AssignmentContext,
): V8EligibilityResult {
    // V8 availability logic is fast enough that we usually run the full engine.
    // This is a stub for high-volume command layer validation.
    return { eligible: true, reasons: [], advisories: [] };
}
