/**
 * Compliance Rule Registry — public API.
 *
 * `RULE_REGISTRY` is the single description of every rule the system enforces.
 * See `./types.ts` for the contract and why the checkable fields are checked.
 */

import { RULE_REGISTRY } from './rules';
import type { RuleLayer, RuleSpec } from './types';

export { RULE_REGISTRY };

/** Every rule, in registration order (shape first, then labour). */
export function allRules(): RuleSpec[] {
    return Object.values(RULE_REGISTRY);
}


export function rulesForLayer(layer: RuleLayer): RuleSpec[] {
    return allRules().filter(r => r.layer === layer);
}


/**
 * Labour rules the CP-SAT model does not implement.
 *
 * Each one is a way the solver can propose a roster that the labour layer then
 * rejects — the divergence the consolidation exists to close. Reported as data
 * rather than prose so the list cannot quietly grow: `registry-parity.test.ts`
 * pins the current set, and adding an unmodelled rule fails that test.
 */
export function solverCoverageGaps(): RuleSpec[] {
    return rulesForLayer('LABOUR').filter(r => r.engines.solver === null);
}

/**
 * Rules carrying a recorded divergence between implementation and agreement.
 * Surfaced as a function so the count is checkable and the list stays honest.
 */
export function rulesWithKnownGaps(): RuleSpec[] {
    return allRules().filter(r => r.knownGap !== undefined);
}
