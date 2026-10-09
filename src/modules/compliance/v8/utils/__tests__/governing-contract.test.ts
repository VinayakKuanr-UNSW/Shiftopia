import { describe, it, expect } from 'vitest';
import { governingContract, isSalariedShift } from '../governing-contract';
import type { ContractRecordV2, V8Employee, V8Shift } from '../../types';

/**
 * The contract that governs a shift must be the one the database links it to
 * (trg_shift_z_link_contract): target first, then role, then sub-department.
 */

const contract = (o: Partial<ContractRecordV2>): ContractRecordV2 => ({
    organization_id: 'org-1',
    department_id: 'dept-1',
    sub_department_id: 'sd-1',
    role_id: 'r-1',
    employment_status: 'Casual',
    pay_basis: 'eba_level',
    ...o,
});

const employee = (contracts: ContractRecordV2[], o: Partial<V8Employee> = {}): V8Employee => ({
    id: 'emp-1',
    name: 'Test',
    contract_type: 'FULL_TIME',
    contracted_weekly_hours: 38,
    contracts,
    ...o,
});

const shift = (o: Partial<V8Shift> = {}): V8Shift => ({
    id: 's-1',
    date: '2026-10-08',
    start_time: '09:00',
    end_time: '17:00',
    ...o,
});

// A salaried Full-Time manager who is also multi-hired as a casual usher.
const manager = contract({ id: 'c-mgr', role_id: 'r-mgr', employment_status: 'Full-Time', pay_basis: 'salary' });
const usher = contract({ id: 'c-ush', role_id: 'r-ush', employment_status: 'Casual', pay_basis: 'eba_level' });
const mixed = employee([manager, usher]);

describe('governingContract', () => {
    it('a single contract governs every shift, history included', () => {
        const only = employee([manager]);
        expect(governingContract(only, shift({ role_id: '' }))).toBe(manager);
    });

    it('picks the contract on the shift’s employment target', () => {
        expect(governingContract(mixed, shift({ target_employment_type: 'Casual', role_id: 'r-ush', sub_department_id: 'sd-1' }))).toBe(usher);
        expect(governingContract(mixed, shift({ target_employment_type: 'FT', role_id: 'r-mgr', sub_department_id: 'sd-1' }))).toBe(manager);
    });

    it('ranks the target above the role, as the link trigger does', () => {
        // A Casual-target shift in the manager's role is worked as a casual.
        expect(governingContract(mixed, shift({ target_employment_type: 'Casual', role_id: 'r-mgr', sub_department_id: 'sd-1' }))).toBe(usher);
    });

    it('never picks a contract from another sub-department', () => {
        const elsewhere = contract({ id: 'c-x', sub_department_id: 'sd-2', employment_status: 'Casual' });
        const emp = employee([manager, elsewhere]);
        expect(governingContract(emp, shift({ target_employment_type: 'Casual', sub_department_id: 'sd-1' }))).toBe(manager);
    });

    it('a shift’s contract link decides outright', () => {
        // History carries no role or target — only the link.
        expect(governingContract(mixed, shift({ role_id: '', user_contract_id: 'c-mgr' }))).toBe(manager);
        // The link beats the matching: the role says manager, the link says usher.
        expect(governingContract(mixed, shift({ role_id: 'r-mgr', target_employment_type: 'FT', user_contract_id: 'c-ush' }))).toBe(usher);
    });

    it('ignores a link to a contract that is no longer active', () => {
        // Not in `contracts` (active only) — falls back to matching.
        expect(governingContract(mixed, shift({ role_id: '', user_contract_id: 'c-ended' }))).toBeNull();
    });

    it('cannot place a history shift for a multi-contract person', () => {
        expect(governingContract(mixed, shift({ role_id: '' }))).toBeNull();
    });

    it('returns null when the best matches disagree on pay', () => {
        // Only the sub-department is known, and both contracts sit in it.
        expect(governingContract(mixed, shift({ sub_department_id: 'sd-1' }))).toBeNull();
    });

    it('returns null with no contracts hydrated', () => {
        expect(governingContract(employee([]), shift({ target_employment_type: 'FT' }))).toBeNull();
    });
});

describe('isSalariedShift', () => {
    it('follows the shift’s own contract', () => {
        expect(isSalariedShift(mixed, shift({ target_employment_type: 'FT', role_id: 'r-mgr', sub_department_id: 'sd-1' }))).toBe(true);
        expect(isSalariedShift(mixed, shift({ target_employment_type: 'Casual', role_id: 'r-ush', sub_department_id: 'sd-1' }))).toBe(false);
    });

    it('an unplaceable shift is salaried only when every contract is', () => {
        expect(isSalariedShift(employee([manager, usher], { is_salaried: false }), shift({ role_id: '' }))).toBe(false);
        expect(isSalariedShift(employee([], { is_salaried: true }), shift())).toBe(true);
    });
});
