/**
 * Compliance Rule Registry — Type Contract
 *
 * ONE description of every rule the system enforces, across both layers and all
 * three engines.
 *
 * WHY A REGISTRY, AND WHY IT MUST BE VERIFIED
 * -------------------------------------------
 * Every previous attempt at this was a hand-maintained table describing rules
 * that lived somewhere else, and each one drifted the same way:
 *
 *   • `CONSTRAINT_TO_VIOLATION` (deleted) mapped V8 rule ids onto local codes.
 *     Two keys named no rule V8 emits and a third rule was never listed, so
 *     three BLOCKING rules were computed and silently discarded.
 *
 *   • `V8_RULE_METADATA` (now derived from here) listed 12 rules while V8 emitted
 *     19. It also carried `V8_MAX_CONSECUTIVE_DAYS`, an id no rule has ever
 *     raised — and because the compliance panel builds its "Passed" list from
 *     that table, a rule that does not exist was permanently reported as passing
 *     while eight real ones never appeared at all.
 *
 * The lesson is not "write a better table". It is that a table describing code
 * in another module is a copy, and copies drift silently. So the fields here
 * that CAN be checked against the implementation — `id`, `name`, `tier` — are
 * checked, in both directions, by `__tests__/registry-parity.test.ts`. Adding a
 * rule without registering it fails the build; registering one that does not
 * exist fails the build; renaming one in either place fails the build.
 *
 * The remaining fields (`authority`, `employment`, `engines`) cannot be derived
 * from code. They are documentation, and they are marked as such.
 */

/**
 * Which layer decides the rule.
 *
 * SHAPE  — decidable from one shift alone: start, end, breaks, day type, target
 *          employment type. No employee, no other shifts. Runs at create/edit.
 * LABOUR — needs a person, or more than one shift, or both. Runs at assignment,
 *          bid, swap, and inside the solver.
 *
 * This is the whole partition. A rule that seems to need both usually has two
 * limbs and should be registered as two rules — see `SHAPE_MEAL_BREAK`.
 */
export type RuleLayer = 'SHAPE' | 'LABOUR';

/** Severity as the implementation currently raises it. Verified against source. */
export type RuleTier = 'BLOCKING' | 'WARNING';

/**
 * Display grouping. The first five are the values `V8_RULE_METADATA` has always
 * used and the compliance panel keys its buckets on; `STRUCTURE` is new and
 * used only by shape rules, which never reach that panel.
 */
export type RuleCategory =
    | 'TIME'
    | 'LEGAL'
    | 'CONTRACT'
    | 'SKILL'
    | 'AVAILABILITY'
    | 'STRUCTURE';

/**
 * EBA-facing employment types. Deliberately NOT either engine's internal enum:
 * V8 says `FULL_TIME`/`FLEXI_PART_TIME`, the shape layer says `FT`/`PT`/`Casual`
 * with flexibility on a second axis, and the solver says `PT` + `is_flexible`.
 * The agreement itself distinguishes four, so the registry does too.
 */
export type EmploymentType = 'FT' | 'PT' | 'FPT' | 'CASUAL';

/** `'ALL'` where the rule genuinely applies to every type — not as a default. */
export type EmploymentScope = 'ALL' | readonly EmploymentType[];

/**
 * Where the obligation comes from. Anything not traceable to the agreement says
 * so, so that a house policy cannot quietly acquire a clause number — which is
 * exactly what happened to the spread cap.
 */
export interface RuleAuthority {
    source: 'eba' | 'statute' | 'policy' | 'operational';
    /** Clause references, e.g. ['cl 35.1(e)', 'cl 35.4(e)']. Empty for non-EBA. */
    clauses: readonly string[];
    /** Statute or policy name when `source` is not 'eba'. */
    instrument?: string;
}

/**
 * Which engines implement the rule.
 *
 * `solver` is the CP-SAT constraint id (`HC-3`, `HC-4`, …) or `null` when the
 * optimizer does not model the rule at all. `null` is load-bearing information,
 * not an absence: it means the solver can propose a roster that the labour layer
 * then rejects, which is the failure mode the whole consolidation exists to
 * prevent. `solverCoverageGaps()` reports them.
 */
export interface RuleEngines {
    /** Raised by `compliance/shape/evaluate.ts`. */
    shape: boolean;
    /** Raised by a rule in `compliance/v8/rules/`. */
    v8: boolean;
    /** CP-SAT constraint id in `optimizer-service/model_builder.py`, or null. */
    solver: string | null;
}

export interface RuleSpec {
    /** The id the implementation emits, verbatim. Verified. */
    id: string;
    /** The `rule_name` the implementation emits, verbatim. Verified. */
    name: string;
    /** Severity the implementation raises. Verified. */
    tier: RuleTier;
    layer: RuleLayer;
    category: RuleCategory;
    /** Documentation — not derivable from code. */
    employment: EmploymentScope;
    /** Documentation — not derivable from code. */
    authority: RuleAuthority;
    /** Documentation — not derivable from code. */
    engines: RuleEngines;
    /** One line, present tense, describing what the rule requires. */
    description: string;
    /**
     * A known divergence between this rule as implemented and the agreement as
     * written. Present only where one has been identified and NOT yet fixed, so
     * the gap is visible in the registry rather than living in a review doc.
     */
    knownGap?: string;
}
