/**
 * Compliance Engine v2 — V8Severity Normalization Layer
 *
 * Rules emit a "base" severity (BLOCKING | WARNING).
 * This layer maps that base severity → effective severity based on:
 *   - operation_type (ASSIGN | BID | SWAP)
 *   - stage (DRAFT | PUBLISH | LIVE)
 *
 * Encoding:
 *   null  → rule is silently skipped for this operation × stage
 *   value → overrides the base severity
 *   (key absent) → keep base severity as-is
 *
 * Rationale:
 *   BID/DRAFT  → softer: manager reviews; we inform, not always block
 *   PUBLISH    → stricter: schedule must be clean before going live
 */

import { V8Severity, V8SeverityOverride, V8SeverityMatrix, V8OperationType, V8Stage } from './types';

// =============================================================================
// DEFAULT SEVERITY MATRIX
// =============================================================================

export const DEFAULT_SEVERITY_MATRIX: V8SeverityMatrix = {
    // Meal break: advisory only — taken at timesheet, not at roster time.
    // Never block assignment over a missing break field; keep visible as a
    // WARNING so managers can confirm at clock-out.
    R08_MEAL_BREAK: {
        ASSIGN: { DRAFT: 'WARNING', PUBLISH: 'WARNING', LIVE: 'WARNING' },
        BID:    { DRAFT: null,      PUBLISH: null,      LIVE: null      },
        SWAP:   { DRAFT: 'WARNING', PUBLISH: 'WARNING', LIVE: 'WARNING' },
    },

    // Qualifications: strict for ASSIGN/SWAP; softer at BID/DRAFT (manager can note exception)
    R11_QUALIFICATIONS: {
        ASSIGN: { DRAFT: 'BLOCKING', PUBLISH: 'BLOCKING', LIVE: 'BLOCKING' },
        BID:    { DRAFT: 'WARNING',  PUBLISH: 'BLOCKING', LIVE: 'BLOCKING' },
        SWAP:   { DRAFT: 'BLOCKING', PUBLISH: 'BLOCKING', LIVE: 'BLOCKING' },
    },

    // Working days cap: warning at draft, blocking at publish
    R04_MAX_WORKING_DAYS: {
        ASSIGN: { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING' },
        BID:    { DRAFT: 'WARNING', PUBLISH: 'WARNING',  LIVE: 'WARNING'  },
        SWAP:   { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING'  },
    },

    // Ordinary hours averaging: same pattern
    R06_ORD_HOURS_AVG: {
        ASSIGN: { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING' },
        BID:    { DRAFT: 'WARNING', PUBLISH: 'WARNING',  LIVE: 'WARNING'  },
        SWAP:   { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING'  },
    },

    // Consecutive days: warning at draft, blocking at publish
    R09_MAX_CONSECUTIVE_DAYS: {
        ASSIGN: { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING' },
        BID:    { DRAFT: 'WARNING', PUBLISH: 'WARNING',  LIVE: 'WARNING'  },
        SWAP:   { DRAFT: 'WARNING', PUBLISH: 'BLOCKING', LIVE: 'WARNING'  },
    },

    // Availability match: ALWAYS advisory — WARNING only, never BLOCKING.
    // Context-aware enforcement happens OUTSIDE the engine via isEligible().
    R_AVAILABILITY_MATCH: {
        ASSIGN: { DRAFT: 'WARNING', PUBLISH: 'WARNING', LIVE: 'WARNING' },
        BID:    { DRAFT: 'WARNING', PUBLISH: 'WARNING', LIVE: 'WARNING' },
        SWAP:   { DRAFT: 'WARNING', PUBLISH: 'WARNING', LIVE: 'WARNING' },
    },
};

// =============================================================================
// RESOLVER
// =============================================================================

/**
 * Returns the effective severity for a rule hit in the given operation × stage context.
 *
 * Returns null if the rule should be dropped from the result set entirely.
 *
 * @param rule_id        The rule's identifier (e.g. 'R08_MEAL_BREAK')
 * @param base_severity  The severity the rule itself returned
 * @param operation_type Current operation context
 * @param stage          DRAFT | PUBLISH | LIVE
 * @param matrix         Override matrix (defaults to DEFAULT_SEVERITY_MATRIX)
 */
export function resolveRuleV8Severity(
    rule_id:        string,
    base_severity:  V8Severity,
    operation_type: V8OperationType,
    stage:          V8Stage,
    matrix:         V8SeverityMatrix = DEFAULT_SEVERITY_MATRIX,
): V8SeverityOverride {
    const override = matrix[rule_id]?.[operation_type]?.[stage];
    // undefined = rule not in matrix for this context → keep base severity
    return override === undefined ? base_severity : override;
}
