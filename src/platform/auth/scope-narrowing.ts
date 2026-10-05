import type { ScopeSelection } from './types';

/**
 * Narrowing a multi-select scope down to what a single-id API wants.
 *
 * `ScopeSelection` is three ARRAYS. A lot of call sites need one id, and the
 * shortcut for that has been `scope.org_ids[0]` — which is not a decision, it is
 * the absence of one. It silently shows the first organisation to someone who can
 * see several, and the Ch.17 production audit counted thirteen-plus pages doing it.
 *
 * The dept and sub-dept levels are not hypothetical: this database has ONE
 * organisation but ELEVEN departments and TWENTY-FIVE sub-departments, and an
 * ORG-scoped manager's default selection contains all of them. `dept_ids[0]`
 * shows such a manager one department out of eleven, today.
 *
 * Three patterns already exist in the codebase, correctly, under three different
 * spellings. This module gives them names so a call site has to say which it
 * means:
 *
 *   1. `orgIds` / `deptIds` / `subDeptIds` — take the WHOLE selection and pass it
 *      down. The default, and what `team-availability.api.ts#getTeamMembers`
 *      already does. Prefer this whenever the API accepts a list.
 *
 *   2. `soleOrgId` / `soleDeptId` / `soleSubDeptId` — the id ONLY when the
 *      selection is unambiguous; `null` for zero OR many. "Many" therefore means
 *      "do not narrow", not "pick one" — the pattern `ManagerSwaps.page.tsx` and
 *      `LeavePage.tsx` spell inline as `length === 1 ? ids[0] : undefined`.
 *
 *   3. Refuse to guess, and make the user choose: an unpicked sub-department
 *      yields no query rather than a guess, which is the right call for
 *      anything that WRITES. `isAmbiguous` is the predicate for rendering that
 *      prompt. (The worked example used to be `useBaselineFt`, whose page has
 *      since been removed; the pattern is the point, not that caller.)
 *
 * Everything here filters through a UUID check first. A non-UUID reaching a
 * PostgREST `.in()` poisons the whole request — one bad value 400s the entire
 * select, and react-query's `= []` default then renders an empty state rather
 * than an error, so the page looks merely empty.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local rather than imported: `platform/` must not depend on `modules/`. */
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const clean = (ids: readonly string[] | null | undefined): string[] =>
  (ids ?? []).filter(isUuid);

/** Every valid organisation id in the selection. */
export const orgIds = (scope: ScopeSelection | null | undefined): string[] =>
  clean(scope?.org_ids);

/** Every valid department id in the selection. */
export const deptIds = (scope: ScopeSelection | null | undefined): string[] =>
  clean(scope?.dept_ids);

/** Every valid sub-department id in the selection. */
export const subDeptIds = (scope: ScopeSelection | null | undefined): string[] =>
  clean(scope?.subdept_ids);

const sole = (ids: string[]): string | null => (ids.length === 1 ? ids[0] : null);

/**
 * The same rule for a bare id array — the roster store keeps its own
 * `selectedDepartmentIds` / `selectedSubDepartmentIds`, which are one layer below
 * `ScopeSelection` but suffer the identical `[0]` defect.
 */
export const soleId = (ids: readonly string[] | null | undefined): string | null =>
  sole(clean(ids));

/**
 * The organisation id, only when the selection names exactly one.
 *
 * `null` means "the caller must not narrow" — either nothing is selected, or
 * several are and choosing between them is not this function's business.
 */
export const soleOrgId = (scope: ScopeSelection | null | undefined): string | null =>
  sole(orgIds(scope));

/** The department id, only when the selection names exactly one. */
export const soleDeptId = (scope: ScopeSelection | null | undefined): string | null =>
  sole(deptIds(scope));

/** The sub-department id, only when the selection names exactly one. */
export const soleSubDeptId = (scope: ScopeSelection | null | undefined): string | null =>
  sole(subDeptIds(scope));

/**
 * True when a level holds MORE than one id, i.e. a single-id surface has to ask
 * the user which one rather than pick. Empty is not ambiguous — it is empty.
 */
export const isOrgAmbiguous = (scope: ScopeSelection | null | undefined): boolean =>
  orgIds(scope).length > 1;

export const isDeptAmbiguous = (scope: ScopeSelection | null | undefined): boolean =>
  deptIds(scope).length > 1;

export const isSubDeptAmbiguous = (scope: ScopeSelection | null | undefined): boolean =>
  subDeptIds(scope).length > 1;
