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
 * SCOPED WHERE IT CAN BE, PERMISSIVE WHERE IT CANNOT.
 *
 * This rule used to match against ANY active contract, on the stated grounds
 * that "the engine does not know which sub-department the candidate shift
 * belongs to". It does now: `V8Shift` carries `sub_department_id` and
 * `role_id`, and `ContractRecordV2` carries each contract's own
 * `employment_status`, so the governing contract can be picked the same way
 * `fn_enforce_shift_employment_target` picks it (migration 20260824130100) —
 * role first, then sub-department.
 *
 * That matters now in a way it did not before. A person can be Full-Time as an
 * Event Setups Manager and Casual as an Usher in the SAME sub-department (EBA
 * cl 13, Multi-Hiring). Person-wide matching passes an FT-targeted shift for
 * them anywhere, including jobs where they are only casual — and the write then
 * fails at the trigger with an error the UI never predicted.
 *
 * The permissive fallback is KEPT, unchanged, for every caller that has not
 * hydrated the scope: no `contracts`, no `sub_department_id`, or no contract
 * naming the shift's role means the old any-contract match still applies.
 * Erring open there means this rule never blocks someone the database would
 * have accepted.
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

    // Contracts that carry their own status — the only ones that can answer the
    // scoped question. A caller that hydrated `contracts` the old way (no
    // status) contributes nothing here and falls through to `statuses`.
    const scopedContracts = (ctx.employee.contracts ?? [])
        .filter(c => !!c.employment_status);

    /**
     * The statuses that govern ONE shift.
     *
     * Mirrors the SQL: prefer the contract naming the shift's role, then any
     * contract in the shift's sub-department (including department-wide ones,
     * which have no sub-department of their own), then — having found nothing
     * to narrow with — every status the person holds.
     */
    const statusesFor = (s: typeof ctx.shifts[number]): string[] => {
        if (scopedContracts.length === 0 || !s.sub_department_id) return statuses;

        const inSubDept = scopedContracts.filter(c =>
            c.sub_department_id === s.sub_department_id || c.sub_department_id === null);
        if (inSubDept.length === 0) return statuses;

        const forRole = s.role_id
            ? inSubDept.filter(c => c.role_id === s.role_id)
            : [];
        const governing = forRole.length > 0 ? forRole : inSubDept;

        return [...new Set<string>(governing.map(c => c.employment_status as string))];
    };

    const hits: V8Hit[] = [];
    for (const s of ctx.shifts) {
        if (s.is_candidate === false) continue; // never re-validate history

        const target = s.target_employment_type;
        if (!target) continue; // not hydrated → the DB trigger still guards it

        const requiresFlexible = target === 'PT' && !!s.target_requires_flexible;
        const governing = statusesFor(s);

        const matches = governing.some(status =>
            contractMatchesTarget(status, target, requiresFlexible),
        );
        if (matches) continue;

        const wanted = requiresFlexible
            ? 'Flexible Part-Time'
            : TARGET_EMPLOYMENT_TYPE_LABELS[target];
        const held = governing.join(', ');

        hits.push({
            rule_id: 'V8_EMPLOYMENT_TARGET',
            rule_name: 'Employment Target',
            status: 'BLOCKING',
            summary: `Shift is for ${wanted} staff`,
            details: `This shift targets ${wanted} employees, but this employee is contracted as ${held}${
                held !== statuses.join(', ') ? ' for this role' : ''
            }. Assign someone on a matching contract, or change the shift's target employment type.`,
            affected_shifts: [s.id],
            blocking: true,
        });
    }

    return hits;
};
