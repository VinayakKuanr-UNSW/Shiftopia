import { V8RuleEvaluator, V8Hit } from '../types';
import {
    contractMatchesTarget,
    TARGET_EMPLOYMENT_TYPE_LABELS,
} from '@/modules/core/model/employment.types';

/**
 * V8 Rule: Employment Target Match
 *
 * BLOCKING rule: a shift declares the employment type it is for
 * (`shifts.target_employment_type`, NOT NULL), and only staff on a matching
 * contract may work it. There is no "Any" target and no manager override.
 *
 * WHY THIS RULE EXISTS AT THE ENGINE LEVEL
 * Audit, 2026-08-05: none of the 63 bid / swap / trade / assign RPCs read the
 * employment target, and the solver's SC-1 was only a cost penalty. Placing the
 * check here means every surface that routes through V8Engine — manual
 * assignment, bidding, and the swap engine — enforces one definition instead of
 * each growing its own.
 *
 * DATA SOURCE — and why not `contract_type`
 * This reads `employee.employment_statuses` (raw per-contract values) rather
 * than `employee.contract_type`, which cannot answer the question:
 *   - it is derived from the GLOBAL `profiles.employment_type`, while the target
 *     is matched against the SUB-DEPARTMENT contract; the two can disagree;
 *   - a student-visa holder has it overwritten with 'STUDENT_VISA'
 *     (employee-context.ts:134), erasing FT/PT/Casual entirely — such an
 *     employee would be barred from every shift.
 *
 * DELIBERATELY PERMISSIVE: a match against ANY active contract passes. The
 * engine does not know which sub-department the candidate shift belongs to, so
 * it cannot narrow the way `trg_shift_employment_target_2_enforce` does. Erring
 * open means this rule never blocks someone the database would have accepted;
 * the rarer opposite case is caught server-side with its own clear message.
 *
 * ABSENT DATA ⇒ SILENT, matching the `leave_days` convention. Callers that have
 * not hydrated `employment_statuses`, or shifts whose target was not loaded,
 * fall through to the DB trigger rather than being blocked on missing input.
 *
 * Candidate scoping follows the per-shift convention: shifts explicitly marked
 * `is_candidate === false` are history and are never re-validated.
 */
export const employmentTargetRule: V8RuleEvaluator = (ctx) => {
    const statuses = ctx.employee.employment_statuses;
    if (!statuses || statuses.length === 0) return [];

    const hits: V8Hit[] = [];
    for (const s of ctx.shifts) {
        if (s.is_candidate === false) continue; // never re-validate history

        const target = s.target_employment_type;
        if (!target) continue; // not hydrated → the DB trigger still guards it

        const requiresFlexible = target === 'PT' && !!s.target_requires_flexible;

        const matches = statuses.some(status =>
            contractMatchesTarget(status, target, requiresFlexible),
        );
        if (matches) continue;

        const wanted = requiresFlexible
            ? 'Flexible Part-Time'
            : TARGET_EMPLOYMENT_TYPE_LABELS[target];
        const held = statuses.join(', ');

        hits.push({
            rule_id: 'V8_EMPLOYMENT_TARGET',
            rule_name: 'Employment Target',
            status: 'BLOCKING',
            summary: `Shift is for ${wanted} staff`,
            details: `This shift targets ${wanted} employees, but this employee is contracted as ${held}. Assign someone on a matching contract, or change the shift's target employment type.`,
            affected_shifts: [s.id],
            blocking: true,
        });
    }

    return hits;
};
