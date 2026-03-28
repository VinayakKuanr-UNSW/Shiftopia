/**
 * R10 — Role Contract Match
 *
 * An employee can only be assigned a shift if they have an active contract
 * that covers the shift's position: (org_id, dept_id, sub_dept_id, role_id).
 *
 * Source of truth: user_contracts rows loaded into ctx.employee.contracts.
 *
 * Partial hierarchy matching (Phase 4):
 *   Only enforces dimensions the candidate shift provides.
 *   If shift.organization_id is absent → not checked.
 *   If shift.sub_department_id is absent → not checked.
 *   role_id is always required when present.
 *
 * Guards:
 *   - No role requirement on shift → skip (R10 not applicable)
 *   - No contracts loaded → skip (cannot enforce without data)
 *
 * BLOCKING always (hard enforcement at any stage).
 */

import type { RuleEvaluatorV2, RuleHitV2 } from '../types';
import type { ContractRecordV2 } from '../types';

function matchesContract(c: ContractRecordV2, shift: {
    role_id?: string;
    organization_id?: string;
    department_id?: string;
    sub_department_id?: string;
}): boolean {
    // role_id must match when provided
    if (shift.role_id && c.role_id !== shift.role_id) return false;
    // org must match when provided by shift
    if (shift.organization_id && c.organization_id !== shift.organization_id) return false;
    // dept must match when provided by shift
    if (shift.department_id && c.department_id !== shift.department_id) return false;
    // sub_dept must match when BOTH shift and contract have it
    if (shift.sub_department_id && c.sub_department_id && c.sub_department_id !== shift.sub_department_id) return false;
    return true;
}

export const R10_role_contract_match: RuleEvaluatorV2 = (ctx) => {
    const contracts = ctx.employee.contracts;

    // No contract data loaded → cannot enforce, skip.
    if (!contracts || contracts.length === 0) return [];

    const hits: RuleHitV2[] = [];

    for (const shift of ctx.candidate_shifts) {
        // No role requirement on shift → R10 does not apply.
        if (!shift.role_id) continue;

        const isValid = contracts.some(c => matchesContract(c, shift));

        if (!isValid) {
            hits.push({
                rule_id:  'R10_ROLE_CONTRACT_MATCH',
                severity: 'BLOCKING',
                message:
                    `Employee is not contracted for this position `
                    + `(${shift.shift_date} ${shift.start_time}–${shift.end_time}).`,
                resolution_hint:
                    'Assign this employee to the required role in their contract, '
                    + 'or select a different employee who is contracted for this position.',
                affected_shifts: [shift.shift_id],
            });
        }
    }

    return hits;
};
