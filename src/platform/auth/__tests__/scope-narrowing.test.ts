import { describe, expect, it } from 'vitest';
import {
  orgIds, deptIds, subDeptIds,
  soleOrgId, soleDeptId, soleSubDeptId,
  isOrgAmbiguous, isDeptAmbiguous, isSubDeptAmbiguous,
} from '../scope-narrowing';
import type { ScopeSelection } from '../types';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const A = U(1), B = U(2), C = U(3);

const scope = (over: Partial<ScopeSelection> = {}): ScopeSelection => ({
  org_ids: [], dept_ids: [], subdept_ids: [], ...over,
});

describe('taking the whole selection', () => {
  it('returns every id at each level', () => {
    const s = scope({ org_ids: [A, B], dept_ids: [A, B, C], subdept_ids: [C] });
    expect(orgIds(s)).toEqual([A, B]);
    expect(deptIds(s)).toEqual([A, B, C]);
    expect(subDeptIds(s)).toEqual([C]);
  });

  it('is empty, never undefined, for a missing scope', () => {
    for (const s of [null, undefined, scope()]) {
      expect(orgIds(s)).toEqual([]);
      expect(deptIds(s)).toEqual([]);
      expect(subDeptIds(s)).toEqual([]);
    }
  });

  it('tolerates a scope object with missing arrays', () => {
    const partial = { org_ids: [A] } as unknown as ScopeSelection;
    expect(orgIds(partial)).toEqual([A]);
    expect(deptIds(partial)).toEqual([]);
  });
});

describe('non-UUIDs are filtered out before they reach a query', () => {
  // A single bad value in a PostgREST `.in()` 400s the WHOLE select, and
  // react-query's `= []` default then renders an empty state rather than an
  // error — so the page looks merely empty. Filtering is not cosmetic.
  const JUNK = ['', 'all', '*', 'null', 'undefined', '00000000', `${A},${B}`, `${A} `, 'DROP TABLE'];

  it.each(JUNK)('drops %s', (bad) => {
    const s = scope({ org_ids: [A, bad], dept_ids: [bad], subdept_ids: [bad, B] });
    expect(orgIds(s)).toEqual([A]);
    expect(deptIds(s)).toEqual([]);
    expect(subDeptIds(s)).toEqual([B]);
  });

  it('drops non-strings without throwing', () => {
    const s = scope({ org_ids: [A, null as never, undefined as never, 7 as never, {} as never] });
    expect(orgIds(s)).toEqual([A]);
  });

  it('treats a junk-only selection as empty, not as one id', () => {
    const s = scope({ org_ids: ['nope', 'also-nope'] });
    expect(orgIds(s)).toEqual([]);
    expect(soleOrgId(s)).toBeNull();
    expect(isOrgAmbiguous(s)).toBe(false);
  });
});

describe('sole* narrows ONLY when unambiguous', () => {
  it('returns the id when exactly one is selected', () => {
    expect(soleOrgId(scope({ org_ids: [A] }))).toBe(A);
    expect(soleDeptId(scope({ dept_ids: [B] }))).toBe(B);
    expect(soleSubDeptId(scope({ subdept_ids: [C] }))).toBe(C);
  });

  it('returns null when SEVERAL are selected, rather than the first', () => {
    // The whole point. `scope.org_ids[0]` would return A here and silently hide B.
    expect(soleOrgId(scope({ org_ids: [A, B] }))).toBeNull();
    expect(soleDeptId(scope({ dept_ids: [A, B, C] }))).toBeNull();
    expect(soleSubDeptId(scope({ subdept_ids: [A, B] }))).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(soleOrgId(scope())).toBeNull();
    expect(soleDeptId(null)).toBeNull();
    expect(soleSubDeptId(undefined)).toBeNull();
  });

  it('narrows once junk reduces the selection to one real id', () => {
    expect(soleOrgId(scope({ org_ids: [A, 'junk'] }))).toBe(A);
  });
});

describe('ambiguity is distinct from emptiness', () => {
  it('is false for zero and one, true for many', () => {
    expect(isOrgAmbiguous(scope({ org_ids: [] }))).toBe(false);
    expect(isOrgAmbiguous(scope({ org_ids: [A] }))).toBe(false);
    expect(isOrgAmbiguous(scope({ org_ids: [A, B] }))).toBe(true);
  });

  it('lets a caller tell "pick one" from "nothing to pick"', () => {
    // A page showing "choose a department" must not show it when the manager
    // has no departments at all — that is a different, emptier state.
    const none = scope({ dept_ids: [] });
    const many = scope({ dept_ids: [A, B] });
    expect(soleDeptId(none)).toBeNull();
    expect(soleDeptId(many)).toBeNull();
    expect(isDeptAmbiguous(none)).toBe(false);
    expect(isDeptAmbiguous(many)).toBe(true);
  });

  it('matches the real production shape: one org, eleven departments', () => {
    // An ORG-scoped manager's default selection contains every department in the
    // org. `dept_ids[0]` shows them one of eleven; this must report ambiguous.
    const real = scope({ org_ids: [A], dept_ids: Array.from({ length: 11 }, (_, i) => U(i === 0 ? 9 : i)) });
    expect(soleOrgId(real)).toBe(A);
    expect(isOrgAmbiguous(real)).toBe(false);
    expect(soleDeptId(real)).toBeNull();
    expect(isDeptAmbiguous(real)).toBe(true);
  });
});
