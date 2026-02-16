/**
 * Compliance Engine
 * 
 * The central decision engine for all compliance checks.
 * 
 * Design principles:
 * - Deterministic: Same input always produces same output
 * - Explainable: Results include reasoning and calculations
 * - Pluggable: New rules can be added without changing core logic
 * - Pure: Never mutates data, only evaluates
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult,
    ComplianceCheckResult,
    ComplianceStatus
} from './types';

// Import rules
import { MaxDailyHoursRule } from './rules/max-daily-hours';
import { MinRestGapRule } from './rules/min-rest-gap';
import { StudentVisa48hRule } from './rules/student-visa-48h';
import { MaxConsecutiveDaysRule } from './rules/max-consecutive-days';

import { NoOverlapRule } from './rules/no-overlap';
import { MinShiftLengthRule } from './rules/min-shift-length';
import { WorkingDaysCapRule } from './rules/working-days-cap';
import { AvgFourWeekCycleRule } from './rules/avg-four-week-cycle';

// =============================================================================
// RULE REGISTRY
// =============================================================================

/**
 * All registered compliance rules.
 * Add new rules here as they are implemented.
 */
const rules: ComplianceRule[] = [
    NoOverlapRule, // Critical blocker

    // Core Limits
    MaxDailyHoursRule,      // 12h max
    MinRestGapRule,         // 10h break
    MaxConsecutiveDaysRule, // Streak limit
    MinShiftLengthRule,     // 3h min

    // Rolling Limits
    WorkingDaysCapRule,     // 20/28 days
    AvgFourWeekCycleRule,   // 152h/4weeks

    // Special Conditions
    StudentVisa48hRule,     // Visa condition
];

// =============================================================================
// ENGINE FUNCTIONS
// =============================================================================

/**
 * Run all applicable compliance checks for a given input.
 * Returns individual results for each rule.
 * 
 * @param input - The compliance check input
 * @returns Array of compliance results, one per applicable rule
 */
export function runComplianceChecks(input: ComplianceCheckInput): ComplianceResult[] {
    // Filter rules that apply to this action type
    const applicableRules = rules.filter(rule => {
        // Skip if explicitly excluded
        if (input.excludeRules?.includes(rule.id)) return false;

        return rule.appliesTo.includes(input.action_type);
    });

    // Evaluate each rule
    return applicableRules.map(rule => rule.evaluate(input));
}

/**
 * Compute the overall status from a set of results.
 * Priority: fail > warning > pass
 */
function computeOverallStatus(results: ComplianceResult[]): ComplianceStatus {
    if (results.some(r => r.status === 'fail' && r.blocking)) {
        return 'fail';
    }
    if (results.some(r => r.status === 'warning')) {
        return 'warning';
    }
    if (results.some(r => r.status === 'fail' && !r.blocking)) {
        return 'warning';  // Non-blocking failures are treated as warnings
    }
    return 'pass';
}

/**
 * Run compliance checks and return aggregated result.
 * Includes overall pass/fail status and separated blockers.
 * 
 * @param input - The compliance check input
 * @returns Aggregated compliance check result
 */
export function checkCompliance(input: ComplianceCheckInput): ComplianceCheckResult {
    const results = runComplianceChecks(input);

    // Find blocking failures
    const blockers = results.filter(r => r.status === 'fail' && r.blocking);

    // Check for warnings
    const hasWarnings = results.some(r => r.status === 'warning');

    // Compute overall status
    const overallStatus = computeOverallStatus(results);

    // Overall pass means no blocking failures
    const passed = blockers.length === 0;
    const hasBlockingFailure = blockers.length > 0;

    return {
        passed,
        hasWarnings,
        hasBlockingFailure,
        overallStatus,
        results,
        blockers
    };
}

/**
 * Get list of all registered rules (for admin/debugging)
 */
export function getRegisteredRules(): Pick<ComplianceRule, 'id' | 'name' | 'description' | 'appliesTo' | 'blocking'>[] {
    return rules.map(({ id, name, description, appliesTo, blocking }) => ({
        id, name, description, appliesTo, blocking
    }));
}

/**
 * Run a single rule by ID (for manual execution in UI)
 */
export function runRule(ruleId: string, input: ComplianceCheckInput): ComplianceResult | null {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) {
        console.warn(`[Compliance] Rule not found: ${ruleId}`);
        return null;
    }

    // Check if rule applies to this action
    if (!rule.appliesTo.includes(input.action_type)) {
        return {
            rule_id: ruleId,
            rule_name: rule.name,
            status: 'pass',
            summary: 'Not applicable to this action type',
            details: `This rule applies to: ${rule.appliesTo.join(', ')}`,
            calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 0 },
            blocking: rule.blocking
        };
    }

    return rule.evaluate(input);
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick check if an action is allowed (no blocking failures)
 */
export function isActionAllowed(input: ComplianceCheckInput): boolean {
    return checkCompliance(input).passed;
}

/**
 * Get human-readable summary of compliance status
 */
export function getComplianceSummary(result: ComplianceCheckResult): string {
    if (!result.passed) {
        const blockerNames = result.blockers.map(b => b.rule_name).join(', ');
        return `Blocked by: ${blockerNames}`;
    }
    if (result.hasWarnings) {
        return 'Allowed with warnings';
    }
    return 'All compliance checks passed';
}
