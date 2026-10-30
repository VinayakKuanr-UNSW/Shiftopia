/**
 * The Users page table (2026-10-16, search and sorting 2026-10-17): who is in
 * scope, how contracts group under people, the per-person summaries, what a
 * search finds, how each column sorts, and what an export contains.
 */
import { describe, expect, it } from 'vitest';
import {
    coversWholeTree,
    DEFAULT_SORT,
    exportRows,
    expiryNote,
    groupUsers,
    inScope,
    licencesSummary,
    rowsOf,
    searchGroups,
    skillsSummary,
    sortRows,
    workRightsSummary,
    type LicenceRef,
    type PersonRef,
    type UsersColumnId,
} from '../usersTable';
import type { ContractRow } from '../contractRows';

const ORG = 'org-icc';
const ICT = 'dept-ict';
const EVENTS = 'dept-events';
const EIS = 'sub-eis';
const SETUP = 'sub-setup';
const TODAY = '2026-10-16';
const EVERYTHING = { org_ids: [], dept_ids: [], subdept_ids: [] };

const contract = (over: Partial<ContractRow>): ContractRow => ({
    id: 'k', user_id: 'kurry', status: 'Active', organization_id: ORG, department_id: ICT, sub_department_id: EIS,
    organizations: { name: 'ICC Sydney' }, departments: { name: 'ICT Services' }, sub_departments: { name: 'Event Information Systems' },
    roles: { name: 'EIS Specialist' }, employment_status: 'Full-Time', pay_basis: 'salary', access_level: 'zeta',
    start_date: '2026-10-09', end_date: null,
    ...over,
});

const people: PersonRef[] = [
    { id: 'kurry', name: 'Kurry Admin', email: 'kurry@example.test' },
    { id: 'bea', name: 'Bea Rivera', email: null },
    { id: 'new', name: 'Ann New', email: 'ann@example.test' },
];

const contracts: ContractRow[] = [
    contract({ id: 'k-eis' }),
    contract({ id: 'k-setup', department_id: EVENTS, sub_department_id: SETUP, departments: { name: 'Events' },
               sub_departments: { name: 'Event Setup' }, roles: { name: 'Event Setup Team Leader' },
               employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 4, access_level: 'beta' }),
    contract({ id: 'b-old', user_id: 'bea', status: 'Expired', end_date: '2026-02-15', roles: { name: 'EIS Coordinator' },
               employment_status: 'Casual', pay_basis: 'eba_level', remuneration_level: 2, access_level: 'alpha' }),
    contract({ id: 'b-eis', user_id: 'bea', employment_status: 'Part-Time', contracted_weekly_hours: 20,
               pay_basis: 'eba_level', remuneration_level: 5, access_level: 'beta' }),
];

const licences: LicenceRef[] = [
    { employee_id: 'kurry', name: 'RSA', license_type: 'Standard', expiration_date: '2026-11-02' },
    { employee_id: 'kurry', name: 'Australian Citizen', license_type: 'WorkRights', verification_status: 'Verified' },
];

describe('the scope', () => {
    it('is decided by the most specific level chosen, and is everything when nothing is', () => {
        const c = contract({});
        expect(inScope(c, EVERYTHING)).toBe(true);
        expect(inScope(c, { org_ids: [ORG], dept_ids: [], subdept_ids: [] })).toBe(true);
        expect(inScope(c, { org_ids: [ORG], dept_ids: [EVENTS], subdept_ids: [] })).toBe(false);
        expect(inScope(c, { org_ids: [ORG], dept_ids: [ICT], subdept_ids: [SETUP] })).toBe(false);
        expect(inScope(c, { org_ids: [ORG], dept_ids: [ICT], subdept_ids: [EIS] })).toBe(true);
    });
});

describe('grouping under people', () => {
    const all = groupUsers({ people, contracts, skills: [], licences, scope: EVERYTHING });

    it('sorts people by name, and lists their contracts active first', () => {
        expect(all.map((g) => g.person.name)).toEqual(['Ann New', 'Bea Rivera', 'Kurry Admin']);
        expect(all.find((g) => g.person.id === 'bea')!.contracts.map((c) => c.id)).toEqual(['b-eis', 'b-old']);
    });

    it('keeps work rights apart from licences', () => {
        const kurry = all.find((g) => g.person.id === 'kurry')!;
        expect(kurry.licences.map((l) => l.name)).toEqual(['RSA']);
        expect(kurry.workRights.map((l) => l.name)).toEqual(['Australian Citizen']);
    });

    it('shows only the contracts inside the scope, and only the people with one', () => {
        const setup = groupUsers({ people, contracts, skills: [], licences, scope: { org_ids: [ORG], dept_ids: [EVENTS], subdept_ids: [] } });
        expect(setup.map((g) => g.person.id)).toEqual(['kurry']);
        expect(setup[0].contracts.map((c) => c.id)).toEqual(['k-setup']);
    });

    it('shows people with no contract at all only while no department or sub-department is chosen', () => {
        expect(all.find((g) => g.person.id === 'new')!.contracts).toEqual([]);
        const org = groupUsers({ people, contracts, skills: [], licences, scope: { org_ids: [ORG], dept_ids: [], subdept_ids: [] } });
        expect(org.some((g) => g.person.id === 'new')).toBe(true);
        const dept = groupUsers({ people, contracts, skills: [], licences, scope: { org_ids: [ORG], dept_ids: [ICT], subdept_ids: [] } });
        expect(dept.some((g) => g.person.id === 'new')).toBe(false);
    });
});

describe('people with no contract yet', () => {
    const TREE = { organizations: [{ id: ORG, name: 'ICC Sydney', departments: [
        { id: ICT, name: 'ICT Services', subdepartments: [{ id: EIS, name: 'Event Information Systems' }] },
        { id: EVENTS, name: 'Events', subdepartments: [{ id: SETUP, name: 'Event Setup' }] },
    ] }] };
    const ALL = { org_ids: [ORG], dept_ids: [ICT, EVENTS], subdept_ids: [EIS, SETUP] };

    it('are everyone only when every place the viewer may choose is chosen', () => {
        expect(coversWholeTree(ALL, TREE as never)).toBe(true);
        expect(coversWholeTree({ ...ALL, subdept_ids: [EIS] }, TREE as never)).toBe(false);
        expect(coversWholeTree({ ...ALL, dept_ids: [ICT] }, TREE as never)).toBe(false);
        expect(coversWholeTree(ALL, null)).toBe(false);
        expect(coversWholeTree(ALL, { organizations: [] } as never)).toBe(false);
    });

    it('show when asked, whatever the scope', () => {
        const shown = groupUsers({ people, contracts, skills: [], licences, scope: ALL, includeUnplaced: true });
        expect(shown.some((g) => g.person.id === 'new')).toBe(true);
        expect(groupUsers({ people, contracts, skills: [], licences, scope: ALL }).some((g) => g.person.id === 'new')).toBe(false);
    });
});

describe('search', () => {
    const all = groupUsers({ people, contracts, skills: [], licences, scope: EVERYTHING });
    const found = (q: string) => searchGroups(all, q).map((g) => `${g.person.id}:${g.contracts.map((c) => c.id).join(',')}`);

    it('finds a person by name or email, with every contract they hold', () => {
        expect(found('kurry')).toEqual(['kurry:k-eis,k-setup']);
        expect(found('ANN@EXAMPLE')).toEqual(['new:']);
    });

    it('finds the contracts a role, place, employment, access or status names', () => {
        expect(found('setup')).toEqual(['kurry:k-setup']);
        expect(found('part-time')).toEqual(['bea:b-eis']);
        expect(found('team lead')).toEqual(['bea:b-eis', 'kurry:k-setup']);
        expect(found('expired')).toEqual(['bea:b-old']);
    });

    it('needs every word, wherever each one is', () => {
        expect(found('kurry casual')).toEqual(['kurry:k-setup']);
        expect(found('kurry coordinator')).toEqual([]);
    });

    it('is everything when blank', () => {
        expect(searchGroups(all, '   ')).toEqual(all);
    });
});

describe('sorting', () => {
    const rows = rowsOf(groupUsers({ people, contracts, skills: [{ employee_id: 'kurry', name: 'Forklift' }], licences, scope: EVERYTHING }));
    const order = (column: UsersColumnId, direction: 'ascending' | 'descending' = 'ascending') =>
        sortRows(rows, { column, direction }, TODAY).map((r) => r.contract?.id ?? `${r.group.person.id}:none`);

    it('has a row per contract, and one for a person with none', () => {
        expect(rows.map((r) => r.key)).toEqual(['person:new', 'b-eis', 'b-old', 'k-eis', 'k-setup']);
        expect(order(DEFAULT_SORT.column)).toEqual(['new:none', 'b-eis', 'b-old', 'k-eis', 'k-setup']);
    });

    it('reverses, keeping a person\'s contracts in their own order where the column can\'t tell them apart', () => {
        expect(order('name', 'descending')).toEqual(['k-eis', 'k-setup', 'b-eis', 'b-old', 'new:none']);
    });

    it('puts empty cells last, whichever way', () => {
        expect(order('role')).toEqual(['b-old', 'b-eis', 'k-eis', 'k-setup', 'new:none']);
        expect(order('role', 'descending')).toEqual(['k-setup', 'b-eis', 'k-eis', 'b-old', 'new:none']);
    });

    it('sorts access by reach, status by the life of a contract, and an ongoing end after every date', () => {
        expect(order('access')).toEqual(['b-old', 'b-eis', 'k-setup', 'k-eis', 'new:none']);
        expect(order('status')).toEqual(['b-eis', 'k-eis', 'k-setup', 'b-old', 'new:none']);
        expect(order('endDate')).toEqual(['b-old', 'b-eis', 'k-eis', 'k-setup', 'new:none']);
    });

    it('sorts levels as numbers, and counts skills', () => {
        expect(order('remuneration')).toEqual(['b-old', 'k-setup', 'b-eis', 'k-eis', 'new:none']);
        expect(order('skills', 'descending')).toEqual(['k-eis', 'k-setup', 'new:none', 'b-eis', 'b-old']);
    });
});

describe('summaries', () => {
    it('warns of anything expired, or expiring within 30 days', () => {
        expect(expiryNote('2026-11-02', TODAY)).toBe('expires 2 Nov 2026');
        expect(expiryNote('2026-10-01', TODAY)).toBe('expired 1 Oct 2026');
        expect(expiryNote('2027-06-01', TODAY)).toBeNull();
        expect(expiryNote(null, TODAY)).toBeNull();
    });

    it('counts skills and names licences', () => {
        expect(skillsSummary([], TODAY)).toEqual({ text: '—', warning: null });
        expect(skillsSummary([{ employee_id: 'x', name: 'Forklift' }, { employee_id: 'x', name: 'First aid', expiration_date: '2026-10-01' }], TODAY))
            .toEqual({ text: '2 skills', warning: 'First aid expired 1 Oct 2026' });
        expect(licencesSummary(licences.slice(0, 1), TODAY)).toEqual({ text: 'RSA', warning: 'RSA expires 2 Nov 2026' });
        const three = ['A', 'B', 'C'].map((name) => ({ employee_id: 'x', name }));
        expect(licencesSummary(three, TODAY).text).toBe('A, B +1');
    });

    it('says what the work rights are, and when they are missing or need a look', () => {
        expect(workRightsSummary([], TODAY)).toEqual({ text: 'Not recorded', warning: 'No work rights recorded' });
        expect(workRightsSummary([{ employee_id: 'x', name: 'Australian Citizen', verification_status: 'Verified' }], TODAY))
            .toEqual({ text: 'Australian Citizen', warning: null });
        expect(workRightsSummary([{ employee_id: 'x', name: 'Subclass 500', expiration_date: '2027-03-03', has_restricted_work_limit: true, verification_status: 'Unverified' }], TODAY))
            .toEqual({ text: 'Subclass 500 · to 3 Mar 2027 · 48 h a fortnight', warning: 'Verification: Unverified' });
    });
});

describe('export', () => {
    const rows = exportRows(groupUsers({ people, contracts, skills: [], licences, scope: EVERYTHING }), TODAY);

    it('has a row per contract, and one for a person with none', () => {
        expect(rows.map((r) => `${r.Name}: ${r.Role}`)).toEqual([
            'Ann New: No contract yet',
            'Bea Rivera: EIS Specialist',
            'Bea Rivera: EIS Coordinator',
            'Kurry Admin: EIS Specialist',
            'Kurry Admin: Event Setup Team Leader',
        ]);
    });

    it('reads as the table does', () => {
        const bea = rows[1];
        expect(bea).toMatchObject({
            Organization: 'ICC Sydney', Department: 'ICT Services', 'Sub-department': 'Event Information Systems',
            Employment: 'Part-Time · 20 h/wk', Remuneration: 'Level 5', Access: 'Team Lead', Status: 'Active',
            'Start date': '9 Oct 2026', 'End date': 'Ongoing', 'Work rights': 'Not recorded',
        });
        expect(rows[2]).toMatchObject({ Status: 'Expired', 'End date': '15 Feb 2026' });
    });

    it('never carries money', () => {
        const withSalary = exportRows(groupUsers({
            people, contracts: [contract({ annual_salary: 95000 } as never)], skills: [], licences: [], scope: EVERYTHING,
        }), TODAY);
        expect(JSON.stringify(withSalary)).not.toMatch(/95|\$/);
    });
});
