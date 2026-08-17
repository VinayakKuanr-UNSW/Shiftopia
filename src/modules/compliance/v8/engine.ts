import { 
    V8RuleContext, 
    V8Result, 
    V8RuleEvaluator, 
    V8Employee, 
    V8Shift, 
    V8Config, 
    DEFAULT_V8_CONFIG,
    V8Status 
} from './types';

// Rule Imports
import { ordinaryHoursAvgRule } from './rules/ordinary-hours-avg';
import { maxDailyHoursRule } from './rules/daily-limits';
import { minRestGapRule } from './rules/rest-requirements';
import { maxWorkdayLimitsRule } from './rules/consecutive-days';
import { studentVisaRule } from './rules/student-visa';
import { noOverlapRule } from './rules/structural-rules';
import { spreadOfHoursRule } from './rules/spread-of-hours';
import { splitShiftRule } from './rules/split-shift';
import { multiHireEligibilityRule } from './rules/multi-hire-eligibility';
import { maxDailyEngagementsRule } from './rules/max-daily-engagements';
import { qualificationRule } from './rules/employment-rules';
import { employmentTargetRule } from './rules/employment-target';
import { leaveConflictRule } from './rules/leave-conflict';
import { ftDaysOffRule } from './rules/ft-days-off';

/**
 * MOVED OUT — shift-shape rules (2026-08-15)
 * ------------------------------------------
 * Minimum engagement, the full-time 7.6h floor, meal breaks and rest pauses are
 * decided from a shift ALONE — its length, its breaks, its day type and its
 * `target_employment_type`. None of them consult the employee. Evaluating them
 * here forced them through an employee-scoped API, which meant they could not
 * run at all until somebody was assigned; an unassigned shift skipped them
 * entirely, and a whole full-time roster sat 6 minutes under the cl 35.1(c)
 * floor without a single hit being raised.
 *
 * They now live in `@/modules/compliance/shape` and run at shift CREATION.
 * A shift whose shape is valid stays valid regardless of who fills it, so
 * re-checking at assign/bid/swap time was duplicate work — this engine no
 * longer does it.
 *
 * Do not re-add them here. If a creation path is missing shape validation, wire
 * `evaluateShiftShape` into that path instead.
 */

// Optimized Rule Execution Order
const ACTIVE_RULES: V8RuleEvaluator[] = [
    // 1. Structural (Fastest)
    leaveConflictRule,       // audit F1 — approved leave = legal-hard unavailability
    noOverlapRule,

    // 2. Staffing
    qualificationRule,
    employmentTargetRule,    // shifts.target_employment_type — HARD match, no "Any"

    // 3. Safety & Breaks
    maxDailyHoursRule,
    spreadOfHoursRule,
    splitShiftRule,          // clause 39 — PT/flexi same-day gap (warns on >3h)
    multiHireEligibilityRule, // clause 13.1(f) — flags same-role "multi-hire" pairs (audit M-1)
    maxDailyEngagementsRule, // clause 35.4(f) — casual hard cap of 2 shifts/day
    minRestGapRule,          // clause 40 — cross-day pairs only
    
    // 4. Budget & Patterns (Cumulative)
    maxWorkdayLimitsRule,    // clause 35.1(e) — 20-in-28 half
    ftDaysOffRule,           // clause 35.1(e) — paired-days-off half
    studentVisaRule,
    ordinaryHoursAvgRule,
];

export class V8Engine {
    private config: V8Config;

    constructor(config: Partial<V8Config> = {}) {
        this.config = { ...DEFAULT_V8_CONFIG, ...config };
    }

    evaluate(
        employee: V8Employee,
        shifts: V8Shift[],
        referenceDate: string = new Date().toISOString().slice(0, 10)
    ): V8Result {
        const t0 = performance.now();
        
        const ctx: V8RuleContext = {
            employee,
            shifts,
            config: this.config,
            reference_date: referenceDate,
        };

        const hits = ACTIVE_RULES.flatMap(rule => rule(ctx));
        
        const hasBlocking = hits.some(h => h.blocking);
        const hasWarning = hits.some(h => h.status === 'WARNING');
        
        let overallStatus: V8Status = 'PASS';
        if (hasBlocking) overallStatus = 'BLOCKING';
        else if (hasWarning) overallStatus = 'WARNING';

        return {
            passed: !hasBlocking,
            overall_status: overallStatus,
            hits,
            solve_time_ms: Math.round((performance.now() - t0) * 100) / 100,
            evaluated_shifts: shifts.length,
        };
    }
}

export const v8Engine = new V8Engine();
