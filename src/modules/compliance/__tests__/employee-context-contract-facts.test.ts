/**
 * Person-wide contract facts in fetchV8EmployeeContext.
 *
 * For someone holding several contracts these used to come from whichever
 * row PostgREST returned first (contract_type, pay_basis) or from ANY row
 * (is_salaried). They are now deterministic: the headline type is the primary
 * engagement's, most permanent first, and "salaried" means every contract is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        from: (...args: any[]) => fromMock(...args),
    },
}));

import { fetchV8EmployeeContext, clearEmployeeContextCache } from '../employee-context';

function makeBuilder(rows: any) {
    const result = Promise.resolve({ data: rows, error: null });
    const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        lte: () => builder,
        gte: () => builder,
        single: () => result,
        then: (resolve: any, reject: any) => result.then(resolve, reject),
    };
    return builder;
}

const contract = (o: Record<string, unknown>) => ({
    id: 'c-x',
    organization_id: 'org-1',
    department_id: 'dept-1',
    sub_department_id: 'sd-1',
    role_id: 'r-1',
    contracted_weekly_hours: 38,
    employment_status: 'Casual',
    pay_basis: 'eba_level',
    engagement_kind: 'primary',
    ...o,
});

const salariedManager = contract({ id: 'c-mgr', role_id: 'r-mgr', employment_status: 'Full-Time', pay_basis: 'salary' });
const casualUsher = contract({ id: 'c-ush', role_id: 'r-ush', employment_status: 'Casual', engagement_kind: 'multi_hire' });

function withContracts(rows: unknown[]) {
    fromMock.mockImplementation((table: string) => {
        // The profile disagrees on purpose — the contracts must win.
        if (table === 'profiles')       return makeBuilder({ id: 'emp-1', employment_type: 'casual' });
        if (table === 'user_contracts') return makeBuilder(rows);
        if (table === 'roles')          return makeBuilder([{ name: 'Usher' }]);
        return makeBuilder([]);
    });
}

beforeEach(() => {
    clearEmployeeContextCache();
    fromMock.mockReset();
});

describe('fetchV8EmployeeContext — contract facts', () => {
    it('takes the headline type from the primary engagement, whatever the row order', async () => {
        for (const rows of [[casualUsher, salariedManager], [salariedManager, casualUsher]]) {
            clearEmployeeContextCache();
            withContracts(rows);
            const ctx = await fetchV8EmployeeContext('emp-1');
            expect(ctx.contract_type).toBe('FULL_TIME');
        }
    });

    it('prefers the most permanent of several primary contracts', async () => {
        withContracts([
            contract({ id: 'c-1', role_id: 'r-1', employment_status: 'Casual' }),
            contract({ id: 'c-2', role_id: 'r-2', employment_status: 'Part-Time' }),
        ]);
        const ctx = await fetchV8EmployeeContext('emp-1');
        expect(ctx.contract_type).toBe('PART_TIME');
    });

    it('is not salaried person-wide when only one of the contracts is', async () => {
        withContracts([salariedManager, casualUsher]);
        const ctx = await fetchV8EmployeeContext('emp-1');
        expect(ctx.is_salaried).toBe(false);
        expect(ctx.pay_basis).toBeNull();
    });

    it('is salaried when every contract is', async () => {
        withContracts([salariedManager]);
        const ctx = await fetchV8EmployeeContext('emp-1');
        expect(ctx.is_salaried).toBe(true);
        expect(ctx.pay_basis).toBe('salary');
    });

    it('carries each contract’s id, pay basis and engagement kind for per-shift rules', async () => {
        withContracts([salariedManager, casualUsher]);
        const ctx = await fetchV8EmployeeContext('emp-1');
        expect(ctx.contracts).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'c-mgr', pay_basis: 'salary', engagement_kind: 'primary', employment_status: 'Full-Time' }),
            expect.objectContaining({ id: 'c-ush', pay_basis: 'eba_level', engagement_kind: 'multi_hire', employment_status: 'Casual' }),
        ]));
    });
});
