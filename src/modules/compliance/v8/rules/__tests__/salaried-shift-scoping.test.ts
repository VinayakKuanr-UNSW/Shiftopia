import { describe, it, expect, beforeEach } from 'vitest';
import { minRestGapRule } from '../rest-requirements';
import { dailySpreadRule } from '../daily-spread';
import { splitShiftRule } from '../split-shift';
import { buildContext, buildShift, resetIdCounter } from './_helpers';
import type { ContractRecordV2, V8Employee, V8Shift } from '../../types';

/**
 * Salaried staff are outside the EBA (cl 2.2), so cl 39/40 limits are advisory
 * for them — but only on shifts worked UNDER the salaried contract. Someone who
 * is a salaried manager and also multi-hired as a casual is a casual on their
 * casual shifts, with every EBA protection.
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

const salariedContract = (status = 'Full-Time') =>
    contract({ id: 'c-mgr', role_id: 'r-mgr', employment_status: status, pay_basis: 'salary' });
const casualContract = contract({ id: 'c-ush', role_id: 'r-ush', employment_status: 'Casual', engagement_kind: 'multi_hire' });

const salariedShift = (o: Partial<V8Shift>, target: 'FT' | 'PT' = 'FT') =>
    buildShift({ target_employment_type: target, role_id: 'r-mgr', sub_department_id: 'sd-1', ...o });
const casualShift = (o: Partial<V8Shift>) =>
    buildShift({ target_employment_type: 'Casual', role_id: 'r-ush', sub_department_id: 'sd-1', ...o });

const mixedEmployee = (o: Partial<V8Employee> = {}): Partial<V8Employee> => ({
    contract_type: 'FULL_TIME',
    contracts: [salariedContract(), casualContract],
    is_salaried: false, // not EVERY contract is salaried
    pay_basis: null,
    ...o,
});

beforeEach(() => resetIdCounter());

describe('V8_MIN_REST_GAP — salaried advisory follows the shift’s contract', () => {
    it('stays BLOCKING when the shift after the short break is the casual engagement', () => {
        const hits = minRestGapRule(buildContext({
            employee: mixedEmployee(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '08:00', end_time: '20:00' }),
                casualShift({ date: '2026-10-09', start_time: '05:00', end_time: '10:00' }), // 9h gap
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].status).toBe('BLOCKING');
        expect(hits[0].blocking).toBe(true);
    });

    it('is advisory when both shifts are worked under the salary', () => {
        const hits = minRestGapRule(buildContext({
            employee: mixedEmployee(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '08:00', end_time: '20:00' }),
                salariedShift({ date: '2026-10-09', start_time: '05:00', end_time: '10:00' }),
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].status).toBe('WARNING');
        expect(hits[0].blocking).toBe(false);
    });

    it('stays BLOCKING when one side is history that cannot be placed on a contract', () => {
        const hits = minRestGapRule(buildContext({
            employee: mixedEmployee(),
            shifts: [
                buildShift({ date: '2026-10-08', start_time: '08:00', end_time: '20:00', role_id: '', is_candidate: false }),
                salariedShift({ date: '2026-10-09', start_time: '05:00', end_time: '10:00', is_candidate: true }),
            ],
        }));
        expect(hits[0].status).toBe('BLOCKING');
    });

    it('a person whose only contract is salaried gets the advisory on history too', () => {
        const hits = minRestGapRule(buildContext({
            employee: { contracts: [salariedContract()], is_salaried: true, pay_basis: 'salary' },
            shifts: [
                buildShift({ date: '2026-10-08', start_time: '08:00', end_time: '20:00', role_id: '', is_candidate: false }),
                salariedShift({ date: '2026-10-09', start_time: '05:00', end_time: '10:00' }),
            ],
        }));
        expect(hits[0].status).toBe('WARNING');
    });
});

describe('V8_SPLIT_SHIFT_SPREAD — advisory only when every engagement that day is salaried', () => {
    const ptMixed = () => mixedEmployee({
        contract_type: 'PART_TIME',
        contracts: [salariedContract('Part-Time'), casualContract],
    });

    it('stays BLOCKING when one of the day’s engagements is casual', () => {
        const hits = dailySpreadRule(buildContext({
            employee: ptMixed(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '06:00', end_time: '10:00' }, 'PT'),
                casualShift({ date: '2026-10-08', start_time: '15:00', end_time: '20:00' }), // 14h spread
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].status).toBe('BLOCKING');
    });

    it('is advisory when both engagements are salaried', () => {
        const hits = dailySpreadRule(buildContext({
            employee: ptMixed(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '06:00', end_time: '10:00' }, 'PT'),
                salariedShift({ date: '2026-10-08', start_time: '15:00', end_time: '20:00' }, 'PT'),
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].status).toBe('WARNING');
    });
});

describe('V8_SPLIT_SHIFT — skipped only for a pair worked entirely under salary', () => {
    const ptMixed = () => mixedEmployee({
        contract_type: 'PART_TIME',
        contracts: [salariedContract('Part-Time'), casualContract],
    });

    it('still flags a >3h gap when one side is the casual engagement', () => {
        const hits = splitShiftRule(buildContext({
            employee: ptMixed(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '07:00', end_time: '10:00' }, 'PT'),
                casualShift({ date: '2026-10-08', start_time: '15:00', end_time: '18:00' }),
            ],
        }));
        expect(hits).toHaveLength(1);
        expect(hits[0].rule_id).toBe('V8_SPLIT_SHIFT');
    });

    it('is silent when both sides are salaried', () => {
        const hits = splitShiftRule(buildContext({
            employee: ptMixed(),
            shifts: [
                salariedShift({ date: '2026-10-08', start_time: '07:00', end_time: '10:00' }, 'PT'),
                salariedShift({ date: '2026-10-08', start_time: '15:00', end_time: '18:00' }, 'PT'),
            ],
        }));
        expect(hits).toEqual([]);
    });
});
