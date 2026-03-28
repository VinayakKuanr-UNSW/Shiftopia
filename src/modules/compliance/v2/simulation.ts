/**
 * Compliance Engine v2 — Simulation Layer
 *
 * Applies candidate_changes to the existing shift snapshot to produce
 * the hypothetical schedule used by all rules.
 *
 * Pure: never mutates input arrays.
 */

import { ShiftV2, CandidateChangesV2 } from './types';

/**
 * Build the simulated shift state by:
 *   1. Removing shifts whose IDs are in changes.remove_shifts
 *   2. Appending changes.add_shifts
 *
 * This is the equivalent of "what would the schedule look like after
 * this operation is committed?"
 */
export function applySimulation(
    existing: ShiftV2[],
    changes:  CandidateChangesV2,
): ShiftV2[] {
    const removed = new Set(changes.remove_shifts);
    return [
        ...existing.filter(s => !removed.has(s.shift_id)),
        ...changes.add_shifts,
    ];
}
