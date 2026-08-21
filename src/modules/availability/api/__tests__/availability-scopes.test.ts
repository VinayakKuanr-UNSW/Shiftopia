import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `fetchAvailabilityScopes` — which JOBS may this person declare availability for.
 *
 * The list the availability page's sub-department picker is built from, and the
 * one place where "employment is a property of the contract, not the person"
 * becomes something a user can see. Production holds one employee with a
 * Full-Time contract in Building Services · Security and four Casual contracts
 * across Event Delivery · Set-up (three roles) and Live Events · Front of
 * House; the fixture below is that person.
 *
 * What these pin, and why each one fails silently if it breaks:
 *
 *   * the three Set-up contracts collapse to ONE scope. If the grain were the
 *     contract, that employee would get three separate calendars for the same
 *     physical shift;
 *   * the Full-Time scope is still LISTED but not declarable, because the page
 *     has a "contract based — use Leave" card to show for it, and omitting the
 *     scope entirely would make their Security job look like it did not exist;
 *   * scopes are read from `user_contracts`, never from the Type X permission
 *     tree — in production three contract scopes have no matching certificate
 *     and two people hold none at all;
 *   * a names lookup that fails costs LABELS, not scopes. The ids are already
 *     resolved by then, so degrading to "Sub-department" keeps the page working;
 *   * a contracts read that fails returns NOTHING, because an empty scope list
 *     renders as "no jobs" while an unscoped fallback would write a declaration
 *     covering every job the person holds.
 */

const h = vi.hoisted(() => {
    const state = {
        contracts: [] as Array<Record<string, unknown>>,
        subDepartments: [] as Array<{ id: string; name: string }>,
        departments: [] as Array<{ id: string; name: string }>,
        contractsError: null as unknown,
        namesError: null as unknown,
        /** Column lists each table was asked for — a dropped name fails open. */
        selected: {} as Record<string, string>,
    };

    const from = (table: string) => ({
        select: (columns: string) => {
            state.selected[table] = columns;
            if (table === 'user_contracts') {
                return {
                    eq: () => ({
                        eq: async () =>
                            state.contractsError
                                ? { data: null, error: state.contractsError }
                                : { data: state.contracts, error: null },
                    }),
                };
            }
            // sub_departments / departments
            return {
                in: async () =>
                    state.namesError
                        ? { data: null, error: state.namesError }
                        : {
                            data: table === 'sub_departments'
                                ? state.subDepartments
                                : state.departments,
                            error: null,
                        },
            };
        },
    });

    return { state, from };
});

vi.mock('@/platform/supabase/client', () => ({
    supabase: { from: h.from },
}));

const { fetchAvailabilityScopes, fetchScopedContractBasis, fetchContractBasis } =
    await import('../contract-basis.api');

// ── fixtures ────────────────────────────────────────────────────────────────

const SEC = '50000000-0000-0000-0000-000000000001';
const SETUP = '50000000-0000-0000-0000-000000000002';
const FOH = '50000000-0000-0000-0000-000000000003';
const D_BUILD = 'd0000000-0000-0000-0000-000000000001';
const D_EVENT = 'd0000000-0000-0000-0000-000000000002';
const D_LIVE = 'd0000000-0000-0000-0000-000000000003';

const row = (over: Record<string, unknown>) => ({
    employment_status: 'Casual',
    contracted_weekly_hours: 0,
    start_date: '2026-05-25',
    role_id: 'role-tm',
    department_id: D_EVENT,
    sub_department_id: SETUP,
    ordinary_span_start: null,
    ordinary_span_end: null,
    ordinary_days: null,
    ...over,
});

beforeEach(() => {
    h.state.contractsError = null;
    h.state.namesError = null;
    h.state.selected = {};
    h.state.contracts = [
        row({ employment_status: 'Full-Time', contracted_weekly_hours: 38,
              department_id: D_BUILD, sub_department_id: SEC, role_id: 'role-sec7' }),
        row({ role_id: 'role-tm3' }),
        row({ role_id: 'role-lead' }),
        row({ role_id: 'role-member' }),
        row({ department_id: D_LIVE, sub_department_id: FOH, role_id: 'role-usher' }),
    ];
    h.state.subDepartments = [
        { id: SEC, name: 'Security' },
        { id: SETUP, name: 'Set-up' },
        { id: FOH, name: 'Front of House' },
    ];
    h.state.departments = [
        { id: D_BUILD, name: 'Building Services' },
        { id: D_EVENT, name: 'Event Delivery' },
        { id: D_LIVE, name: 'Live Events' },
    ];
});

// ── tests ───────────────────────────────────────────────────────────────────

describe('fetchAvailabilityScopes', () => {
    it('returns one scope per sub-department, not per contract', async () => {
        const { scopes, isError } = await fetchAvailabilityScopes('emp-1');
        expect(isError).toBe(false);
        expect(scopes).toHaveLength(3);
        expect(scopes.map((s) => s.subDepartmentName))
            .toEqual(['Front of House', 'Set-up', 'Security']);
    });

    it('collapses the three Set-up contracts into one scope carrying all three roles', async () => {
        const { scopes } = await fetchAvailabilityScopes('emp-1');
        const setup = scopes.find((s) => s.subDepartmentId === SETUP)!;
        expect(setup.roleIds.sort()).toEqual(['role-lead', 'role-member', 'role-tm3']);
        expect(setup.departmentName).toBe('Event Delivery');
    });

    it('marks the casual jobs declarable and the Full-Time one not', async () => {
        const { scopes } = await fetchAvailabilityScopes('emp-1');
        const by = (id: string) => scopes.find((s) => s.subDepartmentId === id)!;

        expect(by(SETUP).canDeclare).toBe(true);
        expect(by(SETUP).availabilityMode).toBe('OPT_IN');
        expect(by(FOH).canDeclare).toBe(true);

        expect(by(SEC).canDeclare).toBe(false);
        expect(by(SEC).isFullTime).toBe(true);
        expect(by(SEC).availabilityMode).toBe('OPT_OUT');
        expect(by(SEC).contractedWeeklyHours).toBe(38);
    });

    // The Full-Time scope is listed so the page can render its contract card.
    // Dropping it would make that job look as though it did not exist.
    it('lists the Full-Time scope, sorted last', async () => {
        const { scopes } = await fetchAvailabilityScopes('emp-1');
        expect(scopes[scopes.length - 1].subDepartmentId).toBe(SEC);
        expect(scopes.filter((s) => s.canDeclare)).toHaveLength(2);
    });

    it('reads the scope columns from user_contracts', async () => {
        await fetchAvailabilityScopes('emp-1');
        expect(h.state.selected.user_contracts).toContain('sub_department_id');
        expect(h.state.selected.user_contracts).toContain('department_id');
    });

    // A single-job casual — the 93-person majority — gets exactly one scope,
    // which Phase 5 renders as a static label rather than a one-option picker.
    it('returns a single scope for a single-contract employee', async () => {
        h.state.contracts = [row({})];
        const { scopes } = await fetchAvailabilityScopes('emp-1');
        expect(scopes).toHaveLength(1);
        expect(scopes[0].subDepartmentName).toBe('Set-up');
        expect(scopes[0].canDeclare).toBe(true);
    });

    it('returns nothing for an employee holding no Active contract', async () => {
        h.state.contracts = [];
        expect(await fetchAvailabilityScopes('emp-1')).toEqual({ scopes: [], isError: false });
    });

    it('fails CLOSED to an empty list when the contracts read errors', async () => {
        h.state.contractsError = { message: 'boom' };
        const { scopes, isError } = await fetchAvailabilityScopes('emp-1');
        expect(scopes).toEqual([]);
        expect(isError).toBe(true);
    });

    // Degrading to a placeholder label keeps the page usable; dropping the
    // scope would silently remove a job the person actually holds.
    it('keeps every scope when the NAME lookup fails, losing only the labels', async () => {
        h.state.namesError = { message: 'names down' };
        const { scopes, isError } = await fetchAvailabilityScopes('emp-1');
        expect(isError).toBe(false);
        expect(scopes).toHaveLength(3);
        expect(scopes.every((s) => s.subDepartmentName === 'Sub-department')).toBe(true);
        // The ids still resolve, so the scopes remain usable.
        expect(scopes.map((s) => s.subDepartmentId).sort()).toEqual([SEC, SETUP, FOH].sort());
    });

    it('labels a department-wide contract by its department', async () => {
        h.state.contracts = [row({ sub_department_id: null, department_id: D_EVENT })];
        const { scopes } = await fetchAvailabilityScopes('emp-1');
        expect(scopes).toHaveLength(1);
        expect(scopes[0].subDepartmentId).toBeNull();
        expect(scopes[0].subDepartmentName).toBe('All of Event Delivery');
    });

    it('returns nothing for an empty employee id without querying', async () => {
        expect(await fetchAvailabilityScopes('')).toEqual({ scopes: [], isError: false });
        expect(h.state.selected.user_contracts).toBeUndefined();
    });
});

describe('fetchScopedContractBasis', () => {
    it('answers per job, where the person-wide read cannot', async () => {
        // The defect, stated against the API rather than the domain: the
        // person-wide read is what hid the editor from this employee.
        expect((await fetchContractBasis('emp-1')).isFullTime).toBe(true);

        expect((await fetchScopedContractBasis('emp-1', {
            subDepartmentId: SETUP, departmentId: D_EVENT,
        })).isFullTime).toBe(false);

        expect((await fetchScopedContractBasis('emp-1', {
            subDepartmentId: SEC, departmentId: D_BUILD,
        })).isFullTime).toBe(true);
    });

    // The invariant that lets every pre-existing caller keep its meaning.
    it('a null sub-department is the person-wide basis', async () => {
        expect(await fetchScopedContractBasis('emp-1', { subDepartmentId: null }))
            .toEqual(await fetchContractBasis('emp-1'));
    });

    // roleIds feeds the Schedule 3 security check, which asks whether someone
    // holds a security role AT ALL — not whether this job is one.
    it('keeps roleIds person-wide even when scoped to a casual job', async () => {
        const scoped = await fetchScopedContractBasis('emp-1', {
            subDepartmentId: SETUP, departmentId: D_EVENT,
        });
        expect(scoped.roleIds).toContain('role-sec7');
    });

    it('fails CLOSED to the strict basis when the read errors', async () => {
        h.state.contractsError = { message: 'boom' };
        const basis = await fetchScopedContractBasis('emp-1', { subDepartmentId: SETUP });
        expect(basis.isError).toBe(true);
        expect(basis.availabilityMode).toBe('OPT_IN');
        expect(basis.isFullTime).toBe(false);
    });
});
