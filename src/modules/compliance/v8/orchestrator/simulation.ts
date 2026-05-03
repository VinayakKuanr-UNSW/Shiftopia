/**
 * V8 Compliance Engine — Simulation Layer
 */

import { V8OrchestratorShift } from './types';

export function applyV8Simulation(
    existing: V8OrchestratorShift[],
    changes:  { add_shifts: V8OrchestratorShift[]; remove_shifts: string[] },
): V8OrchestratorShift[] {
    const removed = new Set(changes.remove_shifts);
    return [
        ...existing.filter(s => !removed.has(s.id)),
        ...changes.add_shifts,
    ];
}
