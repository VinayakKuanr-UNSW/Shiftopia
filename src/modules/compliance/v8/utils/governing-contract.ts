import type { ContractRecordV2, V8Employee, V8Shift } from '../types';
import { contractMatchesTarget } from '@/modules/core/model/employment.types';

/**
 * Which of a person's contracts governs ONE shift — the engagement it is (or
 * would be) worked under.
 *
 * Mirrors the database link (`trg_shift_z_link_contract` →
 * `auto_link_shift_to_contract`, migration 20261008105058): among the person's
 * active contracts in the shift's sub-department (or with none), prefer one on
 * the shift's employment target, then one naming the shift's role, then one in
 * its exact sub-department. `fn_enforce_shift_employment_target` guarantees a
 * contract on the target exists for every assignment the database accepts, so
 * ranking the target first finds the contract the shift will be paid under.
 *
 * A shift that carries its link (`user_contract_id` — committed shifts, incl.
 * history from `get_employee_shift_window` since 20261009023631) is governed
 * by that contract outright.
 *
 * Returns null when the shift cannot be placed:
 *   - no contracts hydrated;
 *   - several contracts, no usable link, and the shift names no target, role
 *     or sub-department;
 *   - the best matches disagree on employment status or pay basis.
 * Callers then fall back to person-wide facts that cannot under-enforce.
 *
 * A person with ONE contract is governed by it everywhere, history included.
 */
export function governingContract(employee: V8Employee, shift: V8Shift): ContractRecordV2 | null {
    const contracts = employee.contracts ?? [];
    if (contracts.length === 0) return null;
    // A committed shift says which contract it was worked under.
    if (shift.user_contract_id) {
        const linked = contracts.find(c => c.id === shift.user_contract_id);
        if (linked) return linked;
    }
    if (contracts.length === 1) return contracts[0];

    const target = shift.target_employment_type ?? null;
    const role = shift.role_id || null;          // history shifts carry ''
    const sub = shift.sub_department_id ?? null;
    if (!target && !role && !sub) return null;

    const inScope = contracts.filter(c =>
        !sub || c.sub_department_id === sub || c.sub_department_id === null);
    if (inScope.length === 0) return null;

    // Weights reproduce the trigger's ORDER BY: target, then role, then sub-department.
    const score = (c: ContractRecordV2): number =>
        (target && contractMatchesTarget(c.employment_status, target) ? 4 : 0)
        + (role && c.role_id === role ? 2 : 0)
        + (sub && c.sub_department_id === sub ? 1 : 0);

    const best = Math.max(...inScope.map(score));
    const top = inScope.filter(c => score(c) === best);
    const facts = new Set(top.map(c => `${c.employment_status ?? ''}|${c.pay_basis ?? ''}`));
    return facts.size === 1 ? top[0] : null;
}

/**
 * Is this shift worked under a salaried contract — outside the EBA (cl 2.2)?
 *
 * Decided by the shift's own governing contract. When that cannot be found,
 * the person counts as salaried only if `employee.is_salaried` says EVERY
 * active contract is — so a manager who also holds a casual engagement keeps
 * the EBA protections on any shift that cannot be placed.
 */
export function isSalariedShift(employee: V8Employee, shift: V8Shift): boolean {
    const contract = governingContract(employee, shift);
    if (contract?.pay_basis) return contract.pay_basis === 'salary';
    return !!(employee.is_salaried || employee.pay_basis === 'salary');
}
