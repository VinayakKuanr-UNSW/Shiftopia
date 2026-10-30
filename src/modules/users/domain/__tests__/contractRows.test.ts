/**
 * The words the Users table shows for a contract, and how it orders them
 * (contracts carry access, 2026-10-15). No dollar figures: money lives in
 * Gross Pay only.
 */
import { describe, expect, it } from 'vitest';
import {
    accessOf,
    contractStatus,
    accessReachOf,
    employmentText,
    remunerationText,
    sortContracts,
    type ContractRow,
} from '../contractRows';

const row = (over: Partial<ContractRow>): ContractRow => ({
    id: 'k', status: 'Active', organizations: { name: 'ICC Sydney' },
    departments: { name: 'Events' }, sub_departments: { name: 'Event Setup' }, roles: { name: 'Team Member' },
    ...over,
});

describe('employment and remuneration, in words', () => {
    it.each([
        [{ employment_status: 'Full-Time' }, 'Full-Time · 38 h/wk'],
        [{ employment_status: 'Part-Time', contracted_weekly_hours: 22.5 }, 'Part-Time · 22.5 h/wk'],
        [{ employment_status: 'Flexible Part-Time', annual_guaranteed_hours: 624 }, 'Flexible Part-Time · 624 h/yr'],
        [{ employment_status: 'Casual', contracted_weekly_hours: 0 }, 'Casual'],
    ])('%o → %s', (over, expected) => {
        expect(employmentText(row(over))).toBe(expected);
    });

    it.each([
        [{ pay_basis: 'salary', remuneration_level: null }, 'Salaried'],
        [{ pay_basis: 'eba_level', remuneration_level: 4 }, 'Level 4'],
        [{ pay_basis: 'eba_level', remuneration_level: 0 }, 'Introductory'],
        [{ pay_basis: 'eba_security_annualised', remuneration_level: 4 }, 'Annualised · Level 4'],
        [{ pay_basis: 'eba_level', remuneration_level: 4, is_apprentice: true }, 'Level 4 · Apprentice'],
    ])('%o → %s', (over, expected) => {
        expect(remunerationText(row(over))).toBe(expected);
    });

    it('never shows money', () => {
        expect(remunerationText(row({ pay_basis: 'salary', annual_salary: 95000 } as never))).not.toMatch(/\$|\d{3}/);
    });
});

describe('where access reaches, from the row', () => {
    it.each([
        ['alpha', 'Event Setup'],
        ['beta', 'Event Setup'],
        ['gamma', 'Event Setup'],
        ['delta', 'All of Events'],
        ['epsilon', 'All of ICC Sydney'],
        ['zeta', 'Everywhere'],
    ] as const)('%s → %s', (level, reach) => {
        expect(accessReachOf(row({ access_level: level }))).toBe(reach);
    });
});

describe('access that is not recorded', () => {
    it('is none — never Employee', () => {
        const c = row({ access_level: null });
        expect(accessOf(c)).toBeNull();
        expect(accessReachOf(c)).toBeNull();
    });
});

describe('status, from the dates (set by the database)', () => {
    it.each([
        ['Upcoming', 'upcoming'],
        ['Active', 'active'],
        ['Expired', 'expired'],
        ['Inactive', 'expired'],     // an older row, before dates drove the status
        ['Terminated', 'expired'],
    ])('%s → %s', (status, expected) => {
        expect(contractStatus(row({ status }))).toBe(expected);
    });

    it('orders active, then upcoming, then expired', () => {
        const rows = [row({ id: 'x', status: 'Expired' }), row({ id: 'u', status: 'Upcoming' }), row({ id: 'a', status: 'Active' })];
        expect(sortContracts(rows).map((r) => r.id)).toEqual(['a', 'u', 'x']);
    });
});

describe('order', () => {
    const rows = [
        row({ id: 'ended', status: 'Expired', roles: { name: 'Usher' }, access_level: 'alpha', employment_status: 'Casual' }),
        row({ id: 'tl', roles: { name: 'Event Setup Team Leader' }, access_level: 'beta', employment_status: 'Casual' }),
        row({ id: 'eis', departments: { name: 'ICT Services' }, sub_departments: { name: 'Event Information Systems' },
              roles: { name: 'EIS Specialist' }, access_level: 'zeta', employment_status: 'Full-Time' }),
    ];

    it('puts active contracts first, the most access first among them', () => {
        expect(sortContracts(rows).map((r) => r.id)).toEqual(['eis', 'tl', 'ended']);
    });
});
