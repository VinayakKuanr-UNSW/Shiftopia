import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The single-role wizard hook. One wizard run writes exactly one
 * `hr.user_contracts` row (one contract = one role). These pin: the insert
 * payload shape, editing a saved contract in place, and that the
 * ceiling / FPT-bounds / mixed-permanent checks all short-circuit BEFORE
 * any insert is attempted.
 */

const h = vi.hoisted(() => ({
    inserted: [] as any[],
    insertCalls: 0,
    updates: [] as Array<{ patch: any; opts: any; id: string }>,
    updateCount: 1 as number | null,
    error: null as unknown,
    toasts: [] as Array<{ title?: string; variant?: string; description?: string }>,
    invalidated: [] as any[],
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        schema: () => ({
            from: () => ({
                insert: (rows: any) => {
                    h.insertCalls += 1;
                    h.inserted.push(rows);
                    return Promise.resolve({ error: h.error });
                },
                update: (patch: any, opts: any) => ({
                    eq: (_col: string, id: string) => {
                        h.updates.push({ patch, opts, id });
                        return Promise.resolve({ error: h.error, count: h.updateCount });
                    },
                }),
            }),
        }),
    },
}));

vi.mock('@/modules/core/ui/primitives/use-toast', () => ({
    useToast: () => ({ toast: (t: any) => { h.toasts.push(t); } }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: (q: any) => h.invalidated.push(q) }),
}));

const { useContractWizardForm } = await import('../useContractWizardForm');
const { todayISO } = await import('@/modules/core/lib/date.utils');

const ORG = '00000000-0000-0000-0000-000000000001';
const DEPT = 'd0000000-0000-0000-0000-000000000001';
const SUBDEPT = '50000000-0000-0000-0000-000000000002';
const ROLE = 'role-team-member';

function setup() {
    const { result } = renderHook(() => useContractWizardForm('emp-1'));
    return result;
}

function fillHierarchyAndRole(result: any, status: string, level = 2) {
    act(() => {
        result.current.updateField('organization_id', ORG);
        result.current.updateField('department_id', DEPT);
        result.current.updateField('sub_department_id', SUBDEPT);
        result.current.updateField('role_id', ROLE);
        result.current.updateField('remuneration_level', level);
        result.current.updateField('employment_status', status);
    });
}

beforeEach(() => {
    h.inserted = [];
    h.insertCalls = 0;
    h.updates = [];
    h.updateCount = 1;
    h.error = null;
    h.toasts = [];
    h.invalidated = [];
});

describe('useContractWizardForm', () => {
    it('writes a single row with the expected shape', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time');

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(true);
        expect(h.insertCalls).toBe(1);
        const rows = h.inserted[0];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            user_id: 'emp-1',
            organization_id: ORG,
            department_id: DEPT,
            sub_department_id: SUBDEPT,
            role_id: ROLE,
            remuneration_level: 2,
            employment_status: 'Full-Time',
            contracted_weekly_hours: 38,
        });
        expect(rows[0].position_id).toBeTruthy();
        expect(h.invalidated).toHaveLength(1);
        // starts today, ongoing; the database sets the status from the dates
        expect(rows[0]).toMatchObject({ start_date: todayISO(), end_date: null });
        expect(rows[0]).not.toHaveProperty('status');
    });

    it('sends the dates as given: a backdated start and a last day', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual');
        act(() => {
            result.current.updateField('start_date', '2026-07-01');
            result.current.updateField('end_date', '2026-12-24');
        });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({ start_date: '2026-07-01', end_date: '2026-12-24' });
    });

    it('refuses a last day before the start, and a missing start, without calling insert', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual');
        act(() => {
            result.current.updateField('start_date', '2026-07-01');
            result.current.updateField('end_date', '2026-06-30');
        });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(false);
        expect(h.toasts.at(-1)?.description).toMatch(/A last day on or after the start date/);

        act(() => { result.current.updateField('end_date', ''); result.current.updateField('start_date', ''); });
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(false);
        expect(h.toasts.at(-1)?.description).toMatch(/Start date/);
        expect(h.insertCalls).toBe(0);
    });

    it('Casual (Class 2) writes zero hours', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual');

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({
            employment_status: 'Casual',
            contracted_weekly_hours: 0,
            annual_guaranteed_hours: 0,
        });
    });

    it('refuses to submit past the 38h ceiling, without calling insert', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time');

        const existing = [{ id: 'c1', employment_status: 'Part-Time', contracted_weekly_hours: 10, status: 'Active' }];
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit(existing as any); });

        expect(ok).toBe(false);
        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some(t => t.title === 'Contract Hours Ceiling')).toBe(true);
    });

    it('refuses Flexible Part-Time hours outside 624-1976, without calling insert', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Flexible Part-Time');
        act(() => { result.current.updateField('annual_guaranteed_hours', 100); });

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(false);
        expect(h.insertCalls).toBe(0);
    });

    it('refuses Part-Time at 38h/week — Part-Time must be less than 38 (cl 12.3(b))', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Part-Time');
        act(() => { result.current.updateField('contracted_weekly_hours', 38); });

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(false);
        expect(h.insertCalls).toBe(0);
        expect(result.current.hoursRule?.valid).toBe(false);
    });

    it('accepts Part-Time under 38h/week', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Part-Time');
        act(() => { result.current.updateField('contracted_weekly_hours', 37.5); });

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(true);
        expect(h.inserted[0][0].contracted_weekly_hours).toBe(37.5);
    });

    it('has no hours rule for Casual and does not tie the level to the role', () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 5);
        act(() => { result.current.updateField('role_id', 'some-other-role'); });

        expect(result.current.hoursRule).toBeNull();
        expect(result.current.formData.remuneration_level).toBe(5);
    });

    it('refuses a new Full-Time contract when another permanent contract is already Active', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time');

        const existing = [{ id: 'c1', employment_status: 'Part-Time', contracted_weekly_hours: 0, status: 'Active' }];
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit(existing as any); });

        expect(ok).toBe(false);
        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some(t => t.title === 'Conflicting Engagements')).toBe(true);
    });

    it('refuses submit when required fields are missing', async () => {
        const result = setup();
        act(() => { result.current.updateField('employment_status', 'Full-Time'); });

        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(false);
        expect(h.insertCalls).toBe(0);
        expect(h.toasts.some(t => t.title === 'Validation Error')).toBe(true);
    });
});

/**
 * Pay terms: how a contract is paid, separate from how it is engaged.
 *
 * Five contracts that must save, each as the row the database's CHECKs expect
 * (migration contract_pay_basis), and the near-misses that must stop at the
 * form with their clause rather than reaching the database.
 */
describe('useContractWizardForm — pay terms', () => {
    const EA_TOP = 70997.68; // Level 7 × 38h × 52 (rates from 6 Jul 2026)
    const ctx = (over: Partial<{ band: any; isSecurityRole: boolean }> = {}) =>
        ({ band: null, isSecurityRole: false, eaTopAnnualRate: EA_TOP, ...over });
    const EDM_BAND = { eba_level_min: 6, eba_level_max: 7 };
    const FULL_TIME_SUPERVISOR = {
        id: 'c-ft', employment_status: 'Full-Time', contracted_weekly_hours: 38, status: 'Active', role_id: 'role-supervisor',
    };

    async function save(result: any, existing: any[] = [], context = ctx()) {
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit(existing, context); });
        return ok;
    }

    // ── must save ───────────────────────────────────────────────────────────
    it('1 · a casual on a level', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 2);

        expect(await save(result)).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({
            pay_basis: 'eba_level', remuneration_level: 2, annual_salary: null,
            eba_exclusion_reason: null, engagement_kind: 'primary', multi_hire_request_ref: null, notes: null,
        });
    });

    it('2 · a casual Event Delivery Manager at Level 7, inside the role band', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 7);

        expect(await save(result, [], ctx({ band: EDM_BAND }))).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({ pay_basis: 'eba_level', remuneration_level: 7, notes: null });
    });

    it('3 · a salaried Full-Time manager — no level, a salary and the reason', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 5);
        act(() => { result.current.updateField('pay_basis', 'salary'); });
        act(() => {
            result.current.updateField('annual_salary', 95000);
            result.current.updateField('eba_exclusion_reason', 'managerial');
        });

        expect(await save(result)).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({
            pay_basis: 'salary', remuneration_level: null, annual_salary: 95000,
            eba_exclusion_reason: 'managerial', is_apprentice: false, is_trainee: false, is_sws: false,
        });
    });

    it('4 · Full-Time Security on the annualised rate at Level 4', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 4);
        act(() => { result.current.updateField('pay_basis', 'eba_security_annualised'); });

        expect(await save(result, [], ctx({ isSecurityRole: true }))).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({ pay_basis: 'eba_security_annualised', remuneration_level: 4 });
    });

    it('5 · a casual multi-hire beside a Full-Time contract (cl 13)', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 1);
        act(() => { result.current.updateField('multi_hire_request_ref', ' MH-0042 '); });

        expect(await save(result, [FULL_TIME_SUPERVISOR])).toBe(true);
        expect(h.inserted[0][0]).toMatchObject({
            employment_status: 'Casual', engagement_kind: 'multi_hire', multi_hire_request_ref: 'MH-0042',
        });
    });

    it('saves a level outside the role band once it has a note, and records why', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 5);
        act(() => { result.current.updateField('level_note', 'Still learning the outlet systems'); });

        expect(await save(result, [], ctx({ band: EDM_BAND }))).toBe(true);
        expect(h.inserted[0][0].notes).toBe(
            "Level 5 is outside this role's range (L6–L7): Still learning the outlet systems");
    });

    // ── must stop at the form ───────────────────────────────────────────────
    const refusedWith = (clause: string) =>
        h.insertCalls === 0 && h.toasts.some(t => (t.description ?? '').includes(`(${clause})`));

    it('refuses a salaried casual', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 2);
        act(() => {
            result.current.updateField('pay_basis', 'salary');
            result.current.updateField('annual_salary', 90000);
            result.current.updateField('eba_exclusion_reason', 'managerial');
        });

        expect(await save(result)).toBe(false);
        expect(refusedWith('Sch 2 §1')).toBe(true);
    });

    it('refuses a salary with no reason it is outside the EA', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 5);
        act(() => { result.current.updateField('pay_basis', 'salary'); });
        act(() => { result.current.updateField('annual_salary', 95000); });

        expect(await save(result)).toBe(false);
        expect(refusedWith('cl 2.2')).toBe(true);
    });

    it('refuses a level outside the role band with no note', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 5);

        expect(await save(result, [], ctx({ band: EDM_BAND }))).toBe(false);
        expect(refusedWith('Sch 1')).toBe(true);
    });

    it('refuses Full-Time Security on the plain level rate', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 4);

        expect(await save(result, [], ctx({ isSecurityRole: true }))).toBe(false);
        expect(refusedWith('Sch 2 §1–2')).toBe(true);
    });

    it('refuses a multi-hire without the request reference', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual', 1);

        expect(await save(result, [FULL_TIME_SUPERVISOR])).toBe(false);
        expect(refusedWith('cl 13.1(d)')).toBe(true);
    });

    // ── state the pay basis owns ────────────────────────────────────────────
    it('switching to salary drops the level and the EA wage schemes', () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 5);
        act(() => { result.current.updateField('is_apprentice', true); });
        act(() => { result.current.updateField('pay_basis', 'salary'); });

        expect(result.current.formData.remuneration_level).toBe('');
        expect(result.current.formData.is_apprentice).toBe(false);
    });

    it('switching back to a level drops the salary terms', () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 5);
        act(() => { result.current.updateField('pay_basis', 'salary'); });
        act(() => {
            result.current.updateField('annual_salary', 95000);
            result.current.updateField('eba_exclusion_reason', 'managerial');
        });
        act(() => { result.current.updateField('pay_basis', 'eba_level'); });

        expect(result.current.formData.annual_salary).toBe(0);
        expect(result.current.formData.eba_exclusion_reason).toBe('');
    });

    it('annualised Security keeps a level only within Levels 3–6', () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 7);
        act(() => { result.current.updateField('pay_basis', 'eba_security_annualised'); });
        expect(result.current.formData.remuneration_level).toBe('');

        act(() => { result.current.updateField('remuneration_level', 5); });
        act(() => { result.current.updateField('pay_basis', 'eba_level'); });
        act(() => { result.current.updateField('pay_basis', 'eba_security_annualised'); });
        expect(result.current.formData.remuneration_level).toBe(5);
    });

    it('choosing Casual resets the basis to a level', () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Full-Time', 5);
        act(() => { result.current.updateField('pay_basis', 'salary'); });
        act(() => { result.current.updateField('employment_status', 'Casual'); });

        expect(result.current.formData.pay_basis).toBe('eba_level');
        expect(result.current.formData.employment_status).toBe('Casual');
    });
});

/**
 * Contracts carry access (2026-10-15): the access level is part of the row,
 * and the wizard edits a saved contract in place.
 */
describe('useContractWizardForm — access and editing', () => {
    it('a new contract sends its access only above Employee (the database defaults to Employee)', async () => {
        const result = setup();
        fillHierarchyAndRole(result, 'Casual');
        expect(result.current.formData.access_level).toBe('alpha');
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(true);
        expect(h.inserted[0][0]).not.toHaveProperty('access_level');

        act(() => { result.current.reset(); });
        fillHierarchyAndRole(result, 'Casual');
        act(() => { result.current.updateField('access_level', 'beta'); });
        await act(async () => { ok = await result.current.submit([]); });
        expect(h.inserted[1][0].access_level).toBe('beta');
    });

    it('edits a saved contract in place: an UPDATE by id, never a second row', async () => {
        const result = setup();
        act(() => {
            result.current.loadContract({
                start_date: '2026-03-02', id: 'k-1', organization_id: ORG, department_id: DEPT, sub_department_id: SUBDEPT, role_id: ROLE,
                employment_status: 'Part-Time', contracted_weekly_hours: 20, pay_basis: 'eba_level',
                remuneration_level: 3, access_level: 'gamma', position_id: 'pos-1',
            });
        });
        expect(result.current.editingId).toBe('k-1');
        expect(result.current.formData.access_level).toBe('gamma');
        expect(result.current.formData.start_date).toBe('2026-03-02');
        expect(result.current.formData.end_date).toBe('');
        expect(result.current.formData.contracted_weekly_hours).toBe(20);

        act(() => { result.current.updateField('remuneration_level', 4); });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });

        expect(ok).toBe(true);
        expect(h.insertCalls).toBe(0);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe('k-1');
        expect(h.updates[0].opts).toEqual({ count: 'exact' });
        expect(h.updates[0].patch).toMatchObject({ remuneration_level: 4, employment_status: 'Part-Time' });
        // access untouched in the form: not sent, so it stays exactly as stored
        expect(h.updates[0].patch).not.toHaveProperty('access_level');
        // the position and the person stay as they are
        expect(h.updates[0].patch).not.toHaveProperty('position_id');
        expect(h.updates[0].patch).not.toHaveProperty('user_id');
        expect(h.updates[0].patch).not.toHaveProperty('notes');
    });

    it('says so when the database refused the edit (zero rows, no error)', async () => {
        h.updateCount = 0;
        const result = setup();
        act(() => {
            result.current.loadContract({
                start_date: '2026-03-02', id: 'k-1', organization_id: ORG, department_id: DEPT, sub_department_id: SUBDEPT, role_id: ROLE,
                employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 2,
            });
        });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(false);
        expect(h.toasts.at(-1)).toMatchObject({ title: 'Contract not saved', variant: 'destructive' });
        expect(h.toasts.at(-1)?.description).toMatch(/^Nothing changed/);
    });

    // 2026-10-15: the table showed an Administrator's contracts as "Employee" on a
    // database where access still lives on certificates (contract access empty),
    // and every save sent an access level that database refuses.
    it('a contract with no access recorded loads as none — never as Employee — and saves without touching it', async () => {
        const result = setup();
        act(() => {
            result.current.loadContract({
                start_date: '2026-03-02', id: 'k-eis', organization_id: ORG, department_id: DEPT, sub_department_id: SUBDEPT, role_id: ROLE,
                employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 4, access_level: null,
            });
        });
        expect(result.current.formData.access_level).toBeNull();
        act(() => { result.current.updateField('remuneration_level', 5); });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(true);
        expect(h.updates[0].patch).not.toHaveProperty('access_level');
    });

    it('sends the access when it is changed', async () => {
        const result = setup();
        act(() => {
            result.current.loadContract({
                start_date: '2026-03-02', id: 'k-tl', organization_id: ORG, department_id: DEPT, sub_department_id: SUBDEPT, role_id: ROLE,
                employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 4, access_level: 'alpha',
            });
        });
        act(() => { result.current.updateField('access_level', 'beta'); });
        await act(async () => { await result.current.submit([]); });
        expect(h.updates[0].patch.access_level).toBe('beta');
    });

    it('explains, in words, a database that cannot record access on contracts yet', async () => {
        h.error = { message: 'new row for relation "user_contracts" violates check constraint "user_contracts_no_access_level"' };
        const result = setup();
        fillHierarchyAndRole(result, 'Casual');
        act(() => { result.current.updateField('access_level', 'beta'); });
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.submit([]); });
        expect(ok).toBe(false);
        expect(h.toasts.at(-1)?.description).toMatch(/^Access can't be set on contracts until the pending database update is applied/);
    });
});
