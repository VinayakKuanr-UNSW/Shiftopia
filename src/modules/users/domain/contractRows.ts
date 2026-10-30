/**
 * How the Users page table describes one contract row, and how it orders them.
 * Pure, so the words the table shows are pinned by tests rather than by eye.
 *
 * A contract is one position: place, role, employment type (EBA cl 12.1),
 * remuneration, and the access it gives (contracts carry access, 2026-10-15).
 * No dollar figures here: money lives in Gross Pay only.
 */
import type { AccessLevel } from '@/platform/auth/types';

interface Named { name: string }

export interface ContractRow {
    id: string;
    user_id?: string | null;
    organization_id?: string | null;
    department_id?: string | null;
    sub_department_id?: string | null;
    role_id?: string | null;
    status?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    created_at?: string | null;
    employment_status?: string | null;
    contracted_weekly_hours?: number | string | null;
    annual_guaranteed_hours?: number | string | null;
    pay_basis?: string | null;
    remuneration_level?: number | string | null;
    is_apprentice?: boolean | null;
    is_trainee?: boolean | null;
    is_sws?: boolean | null;
    engagement_kind?: string | null;
    multi_hire_request_ref?: string | null;
    access_level?: AccessLevel | null;
    roles?: Named | null;
    organizations?: Named | null;
    departments?: Named | null;
    sub_departments?: Named | null;
}

/**
 * Upcoming / Active / Expired — set by the database from the start date and the
 * inclusive last day (contract dates drive the contract, 2026-10-16). An expired
 * contract can still be corrected, and a later last day reopens it.
 */
export type ContractStatus = 'upcoming' | 'active' | 'expired';

export function contractStatus(c: ContractRow): ContractStatus {
    if (c.status === 'Active') return 'active';
    if (c.status === 'Upcoming') return 'upcoming';
    return 'expired'; // Expired, and any older 'Inactive' / 'Terminated' row
}

const n = (v: unknown): number => (v == null || v === '' ? 0 : Number(v) || 0);
const hours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

/** "Full-Time · 38 h/wk", "Flexible Part-Time · 624 h/yr", "Casual". */
export function employmentText(c: ContractRow): string {
    const type = c.employment_status || 'No employment type';
    switch (c.employment_status) {
        case 'Full-Time':
            return `${type} · 38 h/wk`;
        case 'Part-Time':
            return n(c.contracted_weekly_hours) > 0 ? `${type} · ${hours(n(c.contracted_weekly_hours))} h/wk` : type;
        case 'Flexible Part-Time':
            return n(c.annual_guaranteed_hours) > 0 ? `${type} · ${hours(n(c.annual_guaranteed_hours))} h/yr` : type;
        default:
            return type;
    }
}

/** "Salaried", "Level 4", "Annualised · Level 4", with "· Apprentice" etc. when a wage scheme applies. */
export function remunerationText(c: ContractRow): string {
    let base: string;
    if (c.pay_basis === 'salary') base = 'Salaried';
    else if (c.remuneration_level == null || c.remuneration_level === '') base = 'No level set';
    else {
        const level = Number(c.remuneration_level);
        const name = level === 0 ? 'Introductory' : `Level ${level}`;
        base = c.pay_basis === 'eba_security_annualised' ? `Annualised · ${name}` : name;
    }
    const scheme = c.is_apprentice ? 'Apprentice' : c.is_trainee ? 'Trainee' : c.is_sws ? 'Supported wage' : null;
    return scheme ? `${base} · ${scheme}` : base;
}


/**
 * The access this contract records — or null when it records none. A database
 * without the contracts-carry-access migration keeps access on certificates
 * and leaves this column empty; never present that as a level (it read as
 * "Employee" for an Administrator).
 */
export const accessOf = (c: ContractRow): AccessLevel | null => c.access_level ?? null;

const ACCESS_RANK: Record<AccessLevel, number> = { zeta: 0, epsilon: 1, delta: 2, gamma: 3, beta: 4, alpha: 5 };
const rankOf = (c: ContractRow) => { const l = accessOf(c); return l ? ACCESS_RANK[l] : 6; };

const STATUS_RANK: Record<ContractStatus, number> = { active: 0, upcoming: 1, expired: 2 };

/** Active, then upcoming, then expired; then the most access; then by place and role. */
export function sortContracts(rows: readonly ContractRow[]): ContractRow[] {
    return [...rows].sort((a, b) =>
        STATUS_RANK[contractStatus(a)] - STATUS_RANK[contractStatus(b)]
        || rankOf(a) - rankOf(b)
        || (a.departments?.name ?? '').localeCompare(b.departments?.name ?? '')
        || (a.sub_departments?.name ?? '').localeCompare(b.sub_departments?.name ?? '')
        || (a.roles?.name ?? '').localeCompare(b.roles?.name ?? ''));
}
