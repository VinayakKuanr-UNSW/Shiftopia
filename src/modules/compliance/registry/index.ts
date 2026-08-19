/**
 * Compliance Rule Registry — public API.
 *
 * `RULE_REGISTRY` is the single description of every rule the system enforces.
 * See `./types.ts` for the contract and why the checkable fields are checked.
 */

import { RULE_REGISTRY } from './rules';
import type { EmploymentType, RuleLayer, RuleSpec } from './types';

export { RULE_REGISTRY };
export type {
    EmploymentScope,
    EmploymentType,
    RuleAuthority,
    RuleCategory,
    RuleEngines,
    RuleLayer,
    RuleSpec,
    RuleTier,
} from './types';

/** Every rule, in registration order (shape first, then labour). */
export function allRules(): RuleSpec[] {
    return Object.values(RULE_REGISTRY);
}

export function getRule(id: string): RuleSpec | undefined {
    return RULE_REGISTRY[id];
}

export function rulesForLayer(layer: RuleLayer): RuleSpec[] {
    return allRules().filter(r => r.layer === layer);
}

/** Rules that bind a given employment type, `'ALL'` scopes included. */
export function rulesForEmployment(type: EmploymentType): RuleSpec[] {
    return allRules().filter(
        r => r.employment === 'ALL' || r.employment.includes(type),
    );
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
