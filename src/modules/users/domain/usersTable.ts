/**
 * The Users page as one table (2026-10-16): a row per contract, grouped under the
 * person, inside the page's global scope. The person's skills, licences and work
 * rights show once per person, as summaries. No dollar figures: remuneration is
 * the basis only (money lives in Gross Pay).
 */
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { accessLevelLabel } from '@/platform/auth/constants';
import type { AccessLevel, ScopeSelection, ScopeTree } from '@/platform/auth/types';
import {
    accessOf,
    contractStatus,
    employmentText,
    remunerationText,
    sortContracts,
    type ContractRow,
    type ContractStatus,
} from './contractRows';

export interface PersonRef {
    id: string;
    name: string;
    email: string | null;
}

export interface SkillRef {
    employee_id: string;
    name: string;
    status?: string | null;
    expiration_date?: string | null;
}

export interface LicenceRef {
    employee_id: string;
    name: string;
    license_type?: string | null;
    status?: string | null;
    verification_status?: string | null;
    expiration_date?: string | null;
    has_restricted_work_limit?: boolean | null;
}

export interface PersonGroup {
    person: PersonRef;
    /** In scope, Active first, then Upcoming, then Expired. Empty: no contract yet. */
    contracts: ContractRow[];
    skills: SkillRef[];
    licences: LicenceRef[];
    workRights: LicenceRef[];
}

/** Inside the scope: the most specific level chosen decides; nothing chosen is everything. */
export function inScope(c: Pick<ContractRow, 'organization_id' | 'department_id' | 'sub_department_id'>, scope: ScopeSelection): boolean {
    if (scope.subdept_ids.length > 0) return !!c.sub_department_id && scope.subdept_ids.includes(c.sub_department_id);
    if (scope.dept_ids.length > 0) return !!c.department_id && scope.dept_ids.includes(c.department_id);
    if (scope.org_ids.length > 0) return !!c.organization_id && scope.org_ids.includes(c.organization_id);
    return true;
}

/** No department or sub-department chosen: people without any contract belong in view (they need one). */
const showsUnplaced = (scope: ScopeSelection) => scope.dept_ids.length === 0 && scope.subdept_ids.length === 0;

/**
 * Every place the viewer may choose is chosen. The scope filter always picks at
 * least one department, so "nothing chosen" never happens on the page; choosing
 * all of them is how a viewer asks for everyone, including people who have no
 * contract yet.
 */
export function coversWholeTree(scope: ScopeSelection, tree: ScopeTree | null | undefined): boolean {
    const orgs = tree?.organizations ?? [];
    if (orgs.length === 0) return false;
    const has = (ids: string[], id: string) => ids.includes(id);
    return orgs.every((o) => has(scope.org_ids, o.id)
        && o.departments.every((d) => has(scope.dept_ids, d.id)
            && d.subdepartments.every((sd) => has(scope.subdept_ids, sd.id))));
}

/** A person per group, sorted by name; contracts outside the scope left out, and so are people with none inside it. */
export function groupUsers(args: {
    people: readonly PersonRef[];
    contracts: readonly ContractRow[];
    skills: readonly SkillRef[];
    licences: readonly LicenceRef[];
    scope: ScopeSelection;
    /** Show people with no contract at all. Default: only while no department or sub-department is chosen. */
    includeUnplaced?: boolean;
}): PersonGroup[] {
    const unplaced = args.includeUnplaced ?? showsUnplaced(args.scope);
    const byPerson = <T extends { employee_id: string }>(rows: readonly T[]) => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
        return m;
    };
    const allContracts = new Map<string, ContractRow[]>();
    for (const c of args.contracts) {
        const uid = (c as { user_id?: string }).user_id;
        if (!uid) continue;
        allContracts.set(uid, [...(allContracts.get(uid) ?? []), c]);
    }
    const skills = byPerson(args.skills);
    const licences = byPerson(args.licences);

    return args.people
        .map((person): PersonGroup | null => {
            const all = allContracts.get(person.id) ?? [];
            const scoped = all.filter((c) => inScope(c, args.scope));
            if (scoped.length === 0 && !(all.length === 0 && unplaced)) return null;
            const held = licences.get(person.id) ?? [];
            return {
                person,
                contracts: sortContracts(scoped),
                skills: skills.get(person.id) ?? [],
                licences: held.filter((l) => l.license_type !== 'WorkRights'),
                workRights: held.filter((l) => l.license_type === 'WorkRights'),
            };
        })
        .filter((g): g is PersonGroup => g !== null)
        .sort((a, b) => a.person.name.localeCompare(b.person.name));
}

// ── Summaries ────────────────────────────────────────────────────────────────

export interface Summary {
    text: string;
    /** Worth a look: something expired, or expiring within 30 days. */
    warning: string | null;
}

const NONE: Summary = { text: '—', warning: null };
const dayText = (iso: string) => format(parseISO(iso), 'd MMM yyyy');
const SOON_DAYS = 30;

/** "expired 2 Oct 2026" / "expires 1 Nov 2026" when it matters; null otherwise. */
export function expiryNote(expiration: string | null | undefined, today: string): string | null {
    if (!expiration) return null;
    const days = differenceInCalendarDays(parseISO(expiration), parseISO(today));
    if (days < 0) return `expired ${dayText(expiration)}`;
    if (days <= SOON_DAYS) return `expires ${dayText(expiration)}`;
    return null;
}

const warningOf = (items: readonly { name: string; expiration_date?: string | null }[], today: string): string | null => {
    const notes = items
        .map((i) => ({ name: i.name, note: expiryNote(i.expiration_date, today) }))
        .filter((n): n is { name: string; note: string } => !!n.note);
    if (notes.length === 0) return null;
    return notes.length === 1 ? `${notes[0].name} ${notes[0].note}` : `${notes.length} expired or expiring`;
};

export function skillsSummary(skills: readonly SkillRef[], today: string): Summary {
    if (skills.length === 0) return NONE;
    return { text: `${skills.length} skill${skills.length === 1 ? '' : 's'}`, warning: warningOf(skills, today) };
}

export function licencesSummary(licences: readonly LicenceRef[], today: string): Summary {
    if (licences.length === 0) return NONE;
    const names = licences.map((l) => l.name);
    const text = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
    return { text, warning: warningOf(licences, today) };
}

export function workRightsSummary(rights: readonly LicenceRef[], today: string): Summary {
    const w = rights[0];
    if (!w) return { text: 'Not recorded', warning: 'No work rights recorded' };
    const parts = [w.name];
    if (w.expiration_date) parts.push(`to ${dayText(w.expiration_date)}`);
    if (w.has_restricted_work_limit) parts.push('48 h a fortnight');
    const expiry = expiryNote(w.expiration_date, today);
    const unverified = w.verification_status && w.verification_status !== 'Verified' ? `${w.verification_status}` : null;
    return { text: parts.join(' · '), warning: expiry ? `Work rights ${expiry}` : unverified ? `Verification: ${unverified}` : null };
}

// ── Search ───────────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<ContractStatus, string> = { upcoming: 'Upcoming', active: 'Active', expired: 'Expired' };

const personText = (p: PersonRef) => `${p.name} ${p.email ?? ''}`;
const contractText = (c: ContractRow) => {
    const access = accessOf(c);
    return [
        c.roles?.name, c.organizations?.name, c.departments?.name, c.sub_departments?.name,
        employmentText(c), remunerationText(c), access ? accessLevelLabel(access) : null, STATUS_TEXT[contractStatus(c)],
    ].filter(Boolean).join(' ');
};

/**
 * The people and contracts a search matches. Every word must appear, in the
 * person's name or email or in the contract (role, place, employment,
 * remuneration, access, status): "kurry setup" finds Kurry's Event Setup
 * contract only, "kurry" all of Kurry's. Blank: everything.
 */
export function searchGroups(groups: readonly PersonGroup[], query: string): PersonGroup[] {
    const words = query.trim().toLocaleLowerCase('en-AU').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...groups];
    const hits = (haystack: string) => {
        const h = haystack.toLocaleLowerCase('en-AU');
        return words.every((w) => h.includes(w));
    };
    return groups.flatMap((g) => {
        const who = personText(g.person);
        if (g.contracts.length === 0) return hits(who) ? [g] : [];
        const contracts = g.contracts.filter((c) => hits(`${who} ${contractText(c)}`));
        return contracts.length > 0 ? [{ ...g, contracts }] : [];
    });
}

// ── Rows and sorting ─────────────────────────────────────────────────────────

/** One table row: a contract, or a person with none (`contract` null). */
export interface UsersRow {
    key: string;
    group: PersonGroup;
    contract: ContractRow | null;
}

/** A row per contract, in the groups' order (by name, then active first); one for a person with none. */
export function rowsOf(groups: readonly PersonGroup[]): UsersRow[] {
    return groups.flatMap((g): UsersRow[] => (g.contracts.length === 0
        ? [{ key: `person:${g.person.id}`, group: g, contract: null }]
        : g.contracts.map((c) => ({ key: c.id, group: g, contract: c }))));
}

export type UsersColumnId =
    | 'name' | 'email' | 'organization' | 'department' | 'subDepartment' | 'role' | 'employment'
    | 'remuneration' | 'access' | 'status' | 'startDate' | 'endDate' | 'skills' | 'licences' | 'workRights';

type SortDirection = 'ascending' | 'descending';

export interface UsersSort {
    column: UsersColumnId;
    direction: SortDirection;
}

export const DEFAULT_SORT: UsersSort = { column: 'name', direction: 'ascending' };

/** Ascending reads Employee → Administrator. */
const ACCESS_ORDER: Record<AccessLevel, number> = { alpha: 0, beta: 1, gamma: 2, delta: 3, epsilon: 4, zeta: 5 };
/** Ascending follows a contract's life: Active, Upcoming, Expired. */
const STATUS_ORDER: Record<ContractStatus, number> = { active: 0, upcoming: 1, expired: 2 };
/** An ongoing contract has no last day: it sorts after every dated one. */
const ONGOING = '9999-12-31';

/** What a row sorts by in a column; null when the cell is empty (always sorted last). */
function sortValueOf(row: UsersRow, column: UsersColumnId, today: string): string | number | null {
    const { group: g, contract: c } = row;
    switch (column) {
        case 'name': return g.person.name;
        case 'email': return g.person.email || null;
        case 'skills': return g.skills.length || null;
        case 'licences': return g.licences.length ? licencesSummary(g.licences, today).text : null;
        case 'workRights': return g.workRights.length ? workRightsSummary(g.workRights, today).text : null;
        default: break;
    }
    if (!c) return null;
    switch (column) {
        case 'organization': return c.organizations?.name || null;
        case 'department': return c.departments?.name || null;
        case 'subDepartment': return c.sub_departments?.name || null;
        case 'role': return c.roles?.name || null;
        case 'employment': return c.employment_status ? employmentText(c) : null;
        case 'remuneration': return remunerationText(c);
        case 'access': { const level = accessOf(c); return level ? ACCESS_ORDER[level] : null; }
        case 'status': return STATUS_ORDER[contractStatus(c)];
        case 'startDate': return c.start_date || null;
        case 'endDate': return c.end_date || ONGOING;
        default: return null;
    }
}

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

/**
 * Rows sorted by one column. Empty cells go last whichever way; ties keep the
 * rows' own order (by name, then active first), so a person's contracts stay
 * together wherever the column can't tell them apart.
 */
export function sortRows(rows: readonly UsersRow[], sort: UsersSort, today: string): UsersRow[] {
    const dir = sort.direction === 'ascending' ? 1 : -1;
    return rows
        .map((row, i) => ({ row, i, v: sortValueOf(row, sort.column, today) }))
        .sort((a, b) => {
            if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
            const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
            return d !== 0 ? d * dir : a.i - b.i;
        })
        .map((k) => k.row);
}

// ── Export ───────────────────────────────────────────────────────────────────

export const EXPORT_COLUMNS = [
    'Name', 'Email', 'Organization', 'Department', 'Sub-department', 'Role', 'Employment',
    'Remuneration', 'Access', 'Status', 'Start date', 'End date', 'Skills', 'Licences', 'Work rights',
] as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

/** One row per contract, as the table shows it (a person with none gets one row). */
export function exportRows(groups: readonly PersonGroup[], today: string): ExportRow[] {
    const rows: ExportRow[] = [];
    for (const g of groups) {
        const person = {
            Name: g.person.name,
            Email: g.person.email ?? '',
            Skills: skillsSummary(g.skills, today).text,
            Licences: licencesSummary(g.licences, today).text,
            'Work rights': workRightsSummary(g.workRights, today).text,
        };
        if (g.contracts.length === 0) {
            rows.push({
                ...person, Organization: '', Department: '', 'Sub-department': '', Role: 'No contract yet',
                Employment: '', Remuneration: '', Access: '', Status: '', 'Start date': '', 'End date': '',
            });
            continue;
        }
        for (const c of g.contracts) {
            const access = accessOf(c);
            rows.push({
                ...person,
                Organization: c.organizations?.name ?? '',
                Department: c.departments?.name ?? '',
                'Sub-department': c.sub_departments?.name ?? '',
                Role: c.roles?.name ?? '',
                Employment: employmentText(c),
                Remuneration: remunerationText(c),
                Access: access ? accessLevelLabel(access) : '',
                Status: STATUS_TEXT[contractStatus(c)],
                'Start date': c.start_date ? dayText(c.start_date) : '',
                'End date': c.end_date ? dayText(c.end_date) : 'Ongoing',
            });
        }
    }
    return rows;
}
