/**
 * TS ↔ SQL parity for shift pay terms.
 *
 * GOLDEN is the output of `internal.resolve_pay_terms` on prod, 2026-10-08
 * (migration 20261008104434). If this test fails after a change to
 * shiftPayTerms.ts, the SQL function needs the same change (or vice versa) —
 * the roster budget and payroll must never price the same shift differently.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveShiftPayTerms,
  contractPayTermsOn,
  normalizeEmploymentType,
  type ShiftPayContract,
  type ShiftPayTerms,
} from '../domain/shiftPayTerms';
import type { PayBasis } from '@/modules/users/domain/contractPayTerms';

interface Case {
  name: string;
  date: string;
  shiftLevel: number | null;
  shiftEmp: string | null;
  basis: PayBasis | null;
  level: number | null;
  salary: number | null;
  status: string | null;
  weekly: number | null;
  scheme: boolean;
  expected: Omit<ShiftPayTerms, 'baseRate'> & { baseRate: number | null };
}

const t = (
  payBasis: PayBasis, employmentType: string, substantiveLevel: number | null,
  paidLevel: number | null, higherDuties: boolean, baseRate: number | null,
) => ({ payBasis, employmentType, substantiveLevel, paidLevel, higherDuties, baseRate });

const GOLDEN: Case[] = [
  { name: 'A no contract, L4 casual shift', date: '2026-10-08', shiftLevel: 4, shiftEmp: 'Casual', basis: null, level: null, salary: null, status: null, weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 4, 4, false, 37.82) },
  { name: 'B casual L7 on an L4 shift', date: '2026-10-08', shiftLevel: 4, shiftEmp: 'Casual', basis: 'eba_level', level: 7, salary: null, status: 'Casual', weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 7, 7, false, 44.92) },
  { name: 'C casual L4 on an L6 shift', date: '2026-10-08', shiftLevel: 6, shiftEmp: 'Casual', basis: 'eba_level', level: 4, salary: null, status: 'Casual', weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 4, 6, true, 43.12) },
  { name: 'D FT L5 on an L7 shift', date: '2026-10-08', shiftLevel: 7, shiftEmp: 'FT', basis: 'eba_level', level: 5, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('eba_level', 'FT', 5, 7, true, 35.93) },
  { name: 'E FT salary 95k', date: '2026-10-08', shiftLevel: 4, shiftEmp: 'FT', basis: 'salary', level: null, salary: 95000, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('salary', 'FT', null, null, false, 48.076923) },
  { name: 'F PT salary 78k at 30h', date: '2026-10-08', shiftLevel: 4, shiftEmp: 'PT', basis: 'salary', level: null, salary: 78000, status: 'Part-Time', weekly: 30, scheme: false,
    expected: t('salary', 'PT', null, null, false, 50) },
  { name: 'G security L4 on an L5 shift', date: '2026-10-08', shiftLevel: 5, shiftEmp: 'FT', basis: 'eba_security_annualised', level: 4, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('eba_security_annualised', 'FT', 4, 5, true, 38.95) },
  { name: 'H security L6 on an L7 shift', date: '2026-10-08', shiftLevel: 7, shiftEmp: 'FT', basis: 'eba_security_annualised', level: 6, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('eba_security_annualised', 'FT', 6, 6, false, 41.49) },
  { name: 'I apprentice L3 on an L6 shift', date: '2026-10-08', shiftLevel: 6, shiftEmp: 'Casual', basis: 'eba_level', level: 3, salary: null, status: 'Casual', weekly: null, scheme: true,
    expected: t('eba_level', 'Casual', 3, 3, false, 35.77) },
  { name: 'J no contract, no level', date: '2026-10-08', shiftLevel: null, shiftEmp: 'Casual', basis: null, level: null, salary: null, status: null, weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', null, null, false, null) },
  { name: 'K salary with no salary recorded', date: '2026-10-08', shiftLevel: 4, shiftEmp: 'FT', basis: 'salary', level: null, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('salary', 'FT', null, null, false, null) },
  { name: 'L casual L5, shift has no level', date: '2026-10-08', shiftLevel: null, shiftEmp: 'Casual', basis: 'eba_level', level: 5, salary: null, status: 'Casual', weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 5, 5, false, 40.49) },
  { name: 'M security L4, shift has no level', date: '2026-10-08', shiftLevel: null, shiftEmp: 'FT', basis: 'eba_security_annualised', level: 4, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('eba_security_annualised', 'FT', 4, 4, false, 36.39) },
  { name: 'N no target, flexible PT contract L2', date: '2026-10-08', shiftLevel: 2, shiftEmp: null, basis: 'eba_level', level: 2, salary: null, status: 'Flexible Part-Time', weekly: 20, scheme: false,
    expected: t('eba_level', 'PT', 2, 2, false, 27.71) },
  { name: 'O casual L7 before the Jul-2026 increase', date: '2026-06-01', shiftLevel: 4, shiftEmp: 'Casual', basis: 'eba_level', level: 7, salary: null, status: 'Casual', weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 7, 7, false, 42.74) },
  { name: 'P PT salary, no weekly hours', date: '2026-10-08', shiftLevel: null, shiftEmp: 'PT', basis: 'salary', level: null, salary: 78000, status: 'Part-Time', weekly: null, scheme: false,
    expected: t('salary', 'PT', null, null, false, 39.473684) },
  { name: 'Q L0 casual on an L1 shift', date: '2026-10-08', shiftLevel: 1, shiftEmp: 'Casual', basis: 'eba_level', level: 0, salary: null, status: 'Casual', weekly: null, scheme: false,
    expected: t('eba_level', 'Casual', 0, 1, true, 33.70) },
  { name: 'R security L3 on an L2 shift', date: '2026-10-08', shiftLevel: 2, shiftEmp: 'FT', basis: 'eba_security_annualised', level: 3, salary: null, status: 'Full-Time', weekly: 38, scheme: false,
    expected: t('eba_security_annualised', 'FT', 3, 3, false, 33.84) },
];

describe('resolveShiftPayTerms matches internal.resolve_pay_terms', () => {
  it.each(GOLDEN)('$name', (c) => {
    const contract: ShiftPayContract | null = c.basis
      ? {
          payBasis: c.basis,
          level: c.level,
          annualSalary: c.salary,
          employmentStatus: c.status,
          contractedWeeklyHours: c.weekly,
          usesWageScheme: c.scheme,
        }
      : null;
    const got = resolveShiftPayTerms({
      shiftDate: c.date,
      shiftLevel: c.shiftLevel,
      shiftEmploymentType: c.shiftEmp,
      contract,
    });
    const { baseRate, ...rest } = got;
    const { baseRate: expectedRate, ...expectedRest } = c.expected;
    expect(rest).toEqual(expectedRest);
    if (expectedRate == null) expect(baseRate).toBeNull();
    else expect(baseRate).toBeCloseTo(expectedRate, 6);
  });
});

describe('contractPayTermsOn matches hr.contract_pay_terms_on', () => {
  const history = [
    { effective_from: '2026-03-01', level: 5 },
    { effective_from: '2026-01-01', level: 4 },
    { effective_from: '2026-07-01', level: 6 },
  ];

  it('takes the latest change on or before the date', () => {
    expect(contractPayTermsOn(history, '2026-05-15')?.level).toBe(5);
    expect(contractPayTermsOn(history, '2026-07-01')?.level).toBe(6);
    expect(contractPayTermsOn(history, '2027-01-01')?.level).toBe(6);
  });

  it('falls back to the earliest change for a date before the first', () => {
    expect(contractPayTermsOn(history, '2025-12-31')?.level).toBe(4);
  });

  it('returns null with no history', () => {
    expect(contractPayTermsOn([], '2026-05-15')).toBeNull();
  });
});

describe('normalizeEmploymentType matches fn_normalize_employment_type', () => {
  it.each([
    ['Full-Time', 'FT'], [' full time ', 'FT'], ['FT', 'FT'],
    ['Part-Time', 'PT'], ['Flexible Part-Time', 'PT'], ['part_time', 'PT'],
    ['Casual', 'Casual'], [null, 'Casual'], ['contractor', 'Casual'],
  ])('%s → %s', (value, expected) => {
    expect(normalizeEmploymentType(value)).toBe(expected);
  });
});
