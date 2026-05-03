/**
 * Swap Evaluator — Layer 4 (Public API)
 *
 * Orchestrates:
 *   1. ScenarioBuilder  → build hypothetical schedule
 *   2. V8SwapEngine → evaluate all constraints simultaneously
 *
 * Usage:
 *   const result = swapEvaluator.evaluate({ partyA, partyB, config });
 *   if (result.feasible) { ... allow swap ... }
 */

import { ScenarioBuilder } from './scenario-builder';
import { V8SwapEngine } from './constraint-engine';
import type { SwapEvaluationInput, SolverResult } from './types';

const scenarioBuilder = new ScenarioBuilder();
const engine = new V8SwapEngine();

export class SwapEvaluator {
    /**
     * Evaluate whether the swap is compliant for both parties.
     *
     * Steps:
     *   1. Build SwapScenario (hypothetical schedules after swap).
     *   2. Run ALL constraints simultaneously against the scenario.
     *   3. Return SolverResult with feasibility verdict and all violations.
     *
     * Average solve time: < 5ms (pure in-memory calculation).
     */
    evaluate(input: SwapEvaluationInput): SolverResult {
        // Layer 1: build hypothetical scenario
        const scenario = scenarioBuilder.build(input.partyA, input.partyB);

        // Layer 2 + 3: evaluate all constraints simultaneously
        // action_type: 'swap' is passed so constraints can self-select applicability.
        return engine.evaluate(scenario, { action_type: 'swap', ...input.config });
    }
}

/** Singleton evaluator — use this directly in components and hooks. */
export const swapEvaluator = new SwapEvaluator();
