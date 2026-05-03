/**
 * evaluateScenario — Unified Entry Point for the Constraint Solver
 *
 * Single function wrapping V8SwapEngine.evaluate().
 * Use this when you already have a pre-built SwapScenario and just need
 * the feasibility result — bypasses the ScenarioBuilder / Evaluator layers.
 *
 * For higher-level use:
 *   - Single-party (add/assign/bid) → assignmentEvaluator.evaluate()
 *   - Two-party swap                → swapEvaluator.evaluate()
 *
 * This is the equivalent of calling `solver.solve(model)` directly in
 * Google OR-Tools after you have already constructed the model.
 */

import { V8SwapEngine } from './constraint-engine';
import type { SwapScenario, SolverConfig, SolverResult } from './types';

const engine = new V8SwapEngine();

/**
 * Evaluate a pre-built SwapScenario against all registered constraints.
 *
 * @param scenario  Hypothetical roster state for both parties after the action.
 * @param config    Optional solver configuration (action_type, rest gaps, etc.).
 * @returns         SolverResult with feasibility verdict and all per-party violations.
 */
export function evaluateScenario(
    scenario: SwapScenario,
    config: SolverConfig = {},
): SolverResult {
    return engine.evaluate(scenario, config);
}
