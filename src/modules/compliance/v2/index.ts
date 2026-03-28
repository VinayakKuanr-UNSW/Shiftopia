/**
 * Compliance Engine v2 — Main Orchestrator
 *
 * Single entry point: evaluateCompliance()
 *
 * Full evaluation flow:
 *   1. Merge config with defaults
 *   2. Cache check → early return if hit
 *   3. Apply simulation (add + remove candidate changes)
 *   4. Derive impact window → scope relevant_shifts
 *   5. Build shared indexes (sort, group, slice windows)  — O(n log n) once
 *   6. Run all rules via RuleContextV2
 *   7. Apply severity normalization (operation × stage matrix)
 *   8. Deduplicate + consolidate hits
 *   9. Compute delta explanation (SIMULATED mode only)
 *  10. Derive final status
 *  11. Optionally attach ConstraintDescriptors (include_constraints option)
 *  12. Cache result and return
 *
 * Swap support:
 *   Call evaluateCompliance() once per employee, then combineSwapResults().
 *
 * Batch support:
 *   Call evaluateCompliance() in a loop (one call per employee × scenario).
 *   The engine is stateless; the cache makes repeated calls cheap.
 */

import {
    ComplianceInputV2,
    ComplianceResultV2,
    ComplianceResultV2WithConstraints,
    RuleContextV2,
    SeverityMatrix,
    DEFAULT_CONFIG_V2,
    EvalMode,
    Stage,
} from './types';

import { applySimulation }      from './simulation';
import {
    deriveImpactWindow,
    sortShiftsByStart,
    groupByCalendarDay,
    shiftsInRollingWindow,
    shiftsInWindow,
    todayUTC,
}                               from './windows';
import { resolveRuleSeverity, DEFAULT_SEVERITY_MATRIX } from './severity-resolver';
import { deduplicateHits, consolidateHits, deriveStatus } from './aggregator';
import { computeDeltaExplanation }  from './explainability';
import { generateConstraints }      from './constraints';
import { buildCacheKey, getAffectedRules, defaultCache, EvaluationCache } from './cache';

// ── Rule imports ──────────────────────────────────────────────────────────────
// R12 (qual expiry)      — merged into R11; single grouped qualification rule.
import { R01_no_overlap }          from './rules/R01_no_overlap';
import { R02_min_shift_length }    from './rules/R02_min_shift_length';
import { R03_max_daily_hours }     from './rules/R03_max_daily_hours';
import { R05_student_visa }        from './rules/R05_student_visa';
import { R06_ordinary_hours_avg }  from './rules/R06_ordinary_hours_avg';
import { R07_rest_gap }            from './rules/R07_rest_gap';
import { R08_meal_break }          from './rules/R08_meal_break';
import { R09_max_consecutive_days } from './rules/R09_max_consecutive_days';
import { R10_role_contract_match } from './rules/R10_role_contract_match';
import { R11_qualifications }      from './rules/R11_qualifications';
import { R_AVAILABILITY_MATCH }    from './rules/R_AVAILABILITY_MATCH';

// =============================================================================
// RULE REGISTRY
// Ordering: structural → eligibility → schedule limits → advisory
// R_AVAILABILITY_MATCH last — it's advisory and skips when no data is provided.
// =============================================================================

const RULES = [
    R01_no_overlap,           // structural — no time overlaps
    R02_min_shift_length,     // structural — duration limits (2h/3h/4h/12h)
    R10_role_contract_match,  // eligibility — role/contract hierarchy
    R11_qualifications,       // eligibility — must hold all valid qualifications (presence + expiry)
    R03_max_daily_hours,      // daily window
    R07_rest_gap,             // minimum rest between consecutive shifts
    R08_meal_break,           // break requirements
    R09_max_consecutive_days, // rolling working-day streak limits (e.g. 6 days)
    R05_student_visa,         // 14-day fortnightly cap (conditional on visa status)
    R06_ordinary_hours_avg,   // 28-day ordinary hours avg (conditional on contract)
    R_AVAILABILITY_MATCH,     // advisory — skipped when availability_data absent
];

// =============================================================================
// OPTIONS
// =============================================================================

export interface EvaluateOptionsV2 {
    /** Evaluation stage — affects severity normalization. Default: 'DRAFT' */
    stage?:               Stage;
    /** Override the severity normalization matrix */
    severity_matrix?:     SeverityMatrix;
    /** Attach ConstraintDescriptorV2[] to the result for solver integration */
    include_constraints?: boolean;
    /** Provide a custom cache instance (useful for testing isolation) */
    cache?:               EvaluationCache;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export function evaluateCompliance(
    input:   ComplianceInputV2,
    options: EvaluateOptionsV2 = {},
): ComplianceResultV2 | ComplianceResultV2WithConstraints {
    const t0 = performance.now();

    // ── 1. Merge config ───────────────────────────────────────────────────────
    const config  = { ...DEFAULT_CONFIG_V2, ...input.config };
    const stage   = options.stage ?? input.stage ?? 'DRAFT';
    const matrix  = options.severity_matrix ?? DEFAULT_SEVERITY_MATRIX;
    const cache   = options.cache ?? defaultCache;
    const refDate = input.evaluation_reference_date ?? todayUTC();

    // ── 2. Cache check ────────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(input);
    const cached   = cache.get(cacheKey);
    if (cached) return cached;

    // ── 3. Simulation ─────────────────────────────────────────────────────────
    const simulated = input.mode === 'SIMULATED'
        ? applySimulation(input.existing_shifts, input.candidate_changes)
        : input.existing_shifts;

    // ── 4. Impact scoping ─────────────────────────────────────────────────────
    const impactWindow    = deriveImpactWindow(input.candidate_changes.add_shifts);
    const relevantShifts  = shiftsInWindow(simulated, impactWindow.from_date, impactWindow.to_date);

    // ── 5. Pre-compute shared indexes (O(n log n) sort once) ──────────────────
    const sortedShifts = sortShiftsByStart(simulated);
    const shiftsByDay  = groupByCalendarDay(simulated);    // cross-midnight safe
    const window28d    = shiftsInRollingWindow(simulated, refDate, 28);
    const window14d    = shiftsInRollingWindow(simulated, refDate, 14);
    const conflictPairs: ComplianceResultV2['conflict_pairs'] = [];

    // ── 6. Build RuleContextV2 ────────────────────────────────────────────────
    const ctx: RuleContextV2 = {
        simulated_shifts: simulated,
        relevant_shifts:  relevantShifts,
        candidate_shifts: input.candidate_changes.add_shifts,
        window_28d:       window28d,
        window_14d:       window14d,
        shifts_by_day:    shiftsByDay,
        sorted_shifts:    sortedShifts,
        impact_window:    impactWindow,
        employee:         input.employee_context,
        reference_date:   refDate,
        config,
        operation_type:   input.operation_type,
        stage,
        conflict_pairs:   conflictPairs,    // rules push here directly
        availability_data: input.availability_data,  // pass through for R_AVAILABILITY_MATCH
    };

    // ── 7. Run rules (all rules run — full picture is more useful than first-fail)
    // If unassigned (skeleton), skip employee-centric rules (R03, R05, R06, R07, R09, R10, R11, AVAILABILITY)
    const isSkeleton = input.employee_id === 'skeleton';
    const rulesToRun = isSkeleton
        ? RULES.filter(rule => 
            rule === R01_no_overlap || 
            rule === R02_min_shift_length || 
            rule === R08_meal_break
          )
        : RULES;

    const rawHits = rulesToRun.flatMap(rule => rule(ctx));

    // ── 8. Severity normalization ─────────────────────────────────────────────
    const normalizedHits = rawHits
        .map(hit => {
            const resolved = resolveRuleSeverity(
                hit.rule_id, hit.severity, input.operation_type, stage, matrix,
            );
            if (resolved === null) return null;    // rule skipped for this context
            return { ...hit, severity: resolved };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);

    // ── 9. Deduplication + consolidation ─────────────────────────────────────
    const dedupedHits        = deduplicateHits(normalizedHits);
    const consolidatedGroups = consolidateHits(dedupedHits);

    // ── 10. Delta explanation (SIMULATED mode only) ────────────────────────────
    const deltaExplanation = input.mode === 'SIMULATED'
        ? computeDeltaExplanation(
            input.existing_shifts,
            simulated,
            input.candidate_changes.add_shifts,
            refDate,
            config,
        )
        : null;

    // ── 11. Final status ───────────────────────────────────────────────────────
    const status = deriveStatus(dedupedHits);

    // ── 12. Derive availability_match summary (advisory — from R_AVAILABILITY_MATCH hits)
    const availabilityMatchSummary = input.availability_data
        ? deriveAvailabilityMatchSummary(
            dedupedHits,
            input.candidate_changes.add_shifts,
          )
        : null;    // null = caller did not supply availability data; check was skipped

    // ── 13. Assemble result ───────────────────────────────────────────────────
    const result: ComplianceResultV2 = {
        status,
        rule_hits:             dedupedHits,
        consolidated_groups:   consolidatedGroups,
        conflict_pairs:        conflictPairs,
        delta_explanation:     deltaExplanation,
        evaluated_shift_count: simulated.length,
        evaluation_time_ms:    Math.round((performance.now() - t0) * 100) / 100,
        availability_match:    availabilityMatchSummary,
    };

    // =============================================================================
// AVAILABILITY MATCH SUMMARY DERIVATION  (private; only called when data present)
// =============================================================================

function deriveAvailabilityMatchSummary(
    hits: import('./types').RuleHitV2[],
    candidateShifts: import('./types').ShiftV2[],
): import('./types').AvailabilityMatchSummary {
    const avHits = hits.filter(h => h.rule_id === 'R_AVAILABILITY_MATCH');

    if (avHits.length === 0) {
        // No hits → fully PASS (declared and no conflict)
        return {
            status:             'PASS',
            declared_available: true,
            has_conflict:       false,
            affected_shift_ids: [],
        };
    }

    // Classify hits: LOCKED (message contains "locked") vs NOT_DECLARED
    const lockedHits    = avHits.filter(h => h.message.includes('locked'));
    const notDeclHits   = avHits.filter(h => !h.message.includes('locked'));

    const hasLocked     = lockedHits.length > 0;
    const hasNotDeclared = notDeclHits.length > 0;

    const affectedIds   = avHits.flatMap(h => h.affected_shifts);

    if (hasLocked) {
        return {
            status:             'FAIL',
            declared_available: false,
            has_conflict:       true,
            conflict_type:      'LOCKED',
            affected_shift_ids: affectedIds,
        };
    }

    return {
        status:             'WARN',
        declared_available: false,
        has_conflict:       hasNotDeclared,
        conflict_type:      'NOT_DECLARED',
        affected_shift_ids: affectedIds,
    };
}

// ── Optional: attach constraint descriptors ────────────────────────────────
    if (options.include_constraints) {
        (result as ComplianceResultV2WithConstraints).constraints = generateConstraints(ctx);
    }

    // ── Cache + return ────────────────────────────────────────────────────────
    cache.set(cacheKey, result, getAffectedRules(input.candidate_changes));

    return result;
}

// =============================================================================
// SWAP SUPPORT  (convenience wrapper for two-way swap)
// =============================================================================

export { combineSwapResults } from './aggregator';

// =============================================================================
// PUBLIC RE-EXPORTS  (consumers import from this single entry point)
// =============================================================================

export type {
    ComplianceInputV2,
    ComplianceResultV2,
    ComplianceResultV2WithConstraints,
    RuleHitV2,
    ConsolidatedGroupV2,
    ConflictPairV2,
    DeltaExplanationV2,
    StateSummaryV2,
    DeltaChange,
    ConstraintDescriptorV2,
    EmployeeContextV2,
    ShiftV2,
    QualificationV2,
    ComplianceConfigV2,
    CandidateChangesV2,
    SeverityMatrix,
    FinalStatus,
    Severity,
    OperationType,
    Stage,
    EvalMode,
    // Availability types
    AvailabilityDataV2,
    AvailabilitySlotV2,
    AssignedShiftIntervalV2,
    AvailabilityMatchSummary,
    AvailabilityMatchStatus,
} from './types';

export { DEFAULT_CONFIG_V2 }       from './types';
export { DEFAULT_SEVERITY_MATRIX } from './severity-resolver';
export { EvaluationCache }         from './cache';
export { RULE_METADATA }           from './rules/registry';

// Shared combined-state validation utility (use this in all final validators)
export { validateCombinedState }   from './validate-combined-state';
export type { CombinedStateInput } from './validate-combined-state';

// Context-aware eligibility gate (use this in assignment / command layer)
export { isEligible }              from './eligibility';
export type { EligibilityResult }  from './eligibility';
