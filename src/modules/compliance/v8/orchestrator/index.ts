/**
 * V8 Compliance Engine — Unified Orchestrator
 * 
 * Orchestrates simulation, V8 core evaluation, and hit aggregation.
 */

import {
    V8OrchestratorInput,
    V8OrchestratorResult,
} from './types';

import { applyV8Simulation }      from './simulation';
import { runV8ComplexBridge }     from '../index';
import { deduplicateV8Hits, consolidateV8Hits, deriveV8Status } from './aggregator';

export function runV8Orchestrator(
    input:   V8OrchestratorInput,
    _options: any = {},
): V8OrchestratorResult {
    const t0 = performance.now();

    // 1. Simulation (High-performance candidate application)
    const simulated = input.mode === 'SIMULATED'
        ? applyV8Simulation(input.existing_shifts, input.candidate_changes)
        : input.existing_shifts;

    // 2. 🏎️ V8 CORE - Unified Evaluation
    const v8Hits = runV8ComplexBridge(input, simulated);

    // 3. Normalization & Aggregation
    const dedupedHits        = deduplicateV8Hits(v8Hits as any);
    const consolidatedGroups = consolidateV8Hits(dedupedHits);
    const status             = deriveV8Status(dedupedHits);

    return {
        passed:                status === 'PASS' || status === 'WARNING',
        overall_status:        status,
        hits:                  dedupedHits,
        consolidated_groups:   consolidatedGroups,
        conflict_pairs:        [],
        delta_explanation:     null,
        evaluated_shift_count: simulated.length,
        evaluation_time_ms:    Math.round((performance.now() - t0) * 100) / 100,
    };
}

// Re-exports
export * from './types';
export { validateV8State }   from './validate-combined-state';
export { isV8Eligible }      from './eligibility';
