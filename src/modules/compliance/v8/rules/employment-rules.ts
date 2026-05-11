import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';

/**
 * V8 Rule: Qualifications & Skills
 * 
 * Ensures the employee holds all skills and licenses required for the shift.
 */
export const qualificationRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts } = ctx;
    const violations: V8Hit[] = [];
    
    // In V8, we expect the caller to have already resolved the employee's skills/licenses
    const employeeQuals = new Set([
        ...(employee.skill_ids || []),
        ...(employee.license_ids || [])
    ]);

    for (const s of shifts) {
        const required = (s as any).required_qualifications || [];
        const missing = required.filter((q: string) => !employeeQuals.has(q));

        if (missing.length > 0) {
            violations.push({
                rule_id: 'V8_QUALIFICATIONS',
                rule_name: 'Qualifications',
                status: 'BLOCKING',
                summary: 'Missing required qualifications',
                details: `Employee is missing ${missing.length} required qualification(s) for this shift.`,
                affected_shifts: [s.id],
                blocking: true,
                calculation: { missing }
            });
        }
    }
    return violations;
};
