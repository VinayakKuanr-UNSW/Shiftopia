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
import { mealBreakRule } from './rules/meal-break';
import { spreadOfHoursRule } from './rules/spread-of-hours';
import { splitShiftRule } from './rules/split-shift';
import { maxDailyEngagementsRule } from './rules/max-daily-engagements';
import { minEngagementRule } from './rules/min-engagement';
import { qualificationRule } from './rules/employment-rules';
import { leaveConflictRule } from './rules/leave-conflict';

// Optimized Rule Execution Order
const ACTIVE_RULES: V8RuleEvaluator[] = [
    // 1. Structural (Fastest)
    leaveConflictRule,       // audit F1 — approved leave = legal-hard unavailability
    noOverlapRule,
    minEngagementRule, // single owner of minimum-duration enforcement
    
    // 2. Staffing
    qualificationRule,
    
    // 3. Safety & Breaks
    mealBreakRule,
    maxDailyHoursRule,
    spreadOfHoursRule,
    splitShiftRule,          // clause 39 — PT/flexi same-day gap (warns on >3h)
    maxDailyEngagementsRule, // clause 35.4(f) — casual hard cap of 2 shifts/day
    minRestGapRule,          // clause 40 — cross-day pairs only
    
    // 4. Budget & Patterns (Cumulative)
    maxWorkdayLimitsRule,
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
