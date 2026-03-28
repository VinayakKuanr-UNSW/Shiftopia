/**
 * R11 — Qualifications & Certification (presence + validity combined)
 *
 * Each required qualification on a candidate shift must be:
 *   a) held by the employee (not missing), AND
 *   b) valid on the shift date (not expired)
 *
 * Formerly split across R11 (presence) and R12 (expiry).
 * Merged into a single rule so the compliance panel shows one grouped item.
 *
 * Operation awareness:
 *   BID  → base severity is BLOCKING but severity-resolver downgrades to WARNING
 *          at DRAFT stage (manager can still approve the bid and note the gap).
 *   ASSIGN/SWAP → BLOCKING at all stages.
 *
 * Qualifications with expires_at === null are non-expiring and always valid.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';

export const R11_qualifications: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];
    const qualMap = new Map(ctx.employee.qualifications.map(q => [q.qualification_id, q]));

    for (const shift of ctx.candidate_shifts) {
        for (const reqQual of shift.required_qualifications) {
            const held = qualMap.get(reqQual);

            if (!held) {
                // Missing qualification
                hits.push({
                    rule_id:  'R11_QUALIFICATIONS',
                    severity: 'BLOCKING',
                    message:
                        `Employee lacks qualification ${reqQual} required for shift `
                        + `${shift.shift_id} (${shift.shift_date} ${shift.start_time}–${shift.end_time}).`,
                    resolution_hint: ctx.operation_type === 'BID'
                        ? 'Employee may bid but manager approval required. Ensure qualification is obtained before assignment.'
                        : 'Assign an employee who holds this qualification, or update the employee qualification records.',
                    affected_shifts: [shift.shift_id],
                });
            } else if (held.expires_at !== null && held.expires_at <= shift.shift_date) {
                // Qualification expired before shift date
                hits.push({
                    rule_id:  'R11_QUALIFICATIONS',
                    severity: 'BLOCKING',
                    message:
                        `Qualification ${reqQual} expired on ${held.expires_at}, `
                        + `before shift ${shift.shift_id} on ${shift.shift_date}.`,
                    resolution_hint:
                        `Renew qualification ${reqQual} before scheduling this shift, `
                        + 'or assign an employee with a current qualification.',
                    affected_shifts: [shift.shift_id],
                });
            }
        }
    }

    return hits;
};
