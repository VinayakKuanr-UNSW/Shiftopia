// src/platform/auth/scope-selection.ts
//
// The global scope filter's rules, kept free of React so they can be tested.
//
// Every tree comes from the person's CONTRACTS (hr.user_contracts, the Users page
// table), built by resolve_user_permissions():
//
//   personal    every sub-department they hold an active contract in
//   managerial  what their gamma-and-above contracts reach
//   timesheet   the managerial reach plus each Team Lead (beta) contract's sub-department
//
// A saved selection is only a wish: it may name places the person can no longer
// reach (a contract ended, someone else used this device), so it is always
// reconciled against the tree before a page reads it.

import type { PermissionObject, ScopeSelection, ScopeTree } from './types';

export type ScopeMode = 'personal' | 'managerial' | 'timesheet';

/** The tree a page in this mode may choose from; null while permissions are unknown. */
export function scopeTreeFor(permissions: PermissionObject | null | undefined, mode: ScopeMode): ScopeTree | null {
    if (!permissions) return null;
    switch (mode) {
        case 'personal':
            return permissions.contracted_scope_tree ?? null;
        case 'timesheet':
            return permissions.timesheet_scope_tree ?? permissions.allowed_scope_tree ?? null;
        case 'managerial':
            return permissions.allowed_scope_tree ?? null;
    }
}

/** Every place in the tree. */
export function defaultSelectionFromTree(tree: ScopeTree | null | undefined): ScopeSelection {
    const orgs = tree?.organizations ?? [];
    return {
        org_ids: orgs.map((o) => o.id),
        dept_ids: orgs.flatMap((o) => o.departments.map((d) => d.id)),
        subdept_ids: orgs.flatMap((o) => o.departments.flatMap((d) => d.subdepartments.map((sd) => sd.id))),
    };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameSelection(a: ScopeSelection, b: ScopeSelection): boolean {
    return sameIds(a.org_ids, b.org_ids) && sameIds(a.dept_ids, b.dept_ids) && sameIds(a.subdept_ids, b.subdept_ids);
}

/**
 * The saved selection, kept to what the tree allows. Each level keeps the ids
 * still under the level above; a level left empty means all of it, as the filter
 * itself does. Nothing usable ⇒ everything. Returns `selection` itself when it
 * is already valid, so a page's memoised queries do not refire.
 */
export function reconcileScope(
    selection: ScopeSelection | null | undefined,
    tree: ScopeTree | null | undefined,
): ScopeSelection {
    const everything = defaultSelectionFromTree(tree);
    if (!selection || everything.org_ids.length === 0) return everything;

    const orgs = (tree?.organizations ?? []).filter((o) => selection.org_ids?.includes(o.id));
    if (orgs.length === 0) return everything;

    const deptPool = orgs.flatMap((o) => o.departments);
    const chosenDepts = deptPool.filter((d) => selection.dept_ids?.includes(d.id));
    const depts = chosenDepts.length > 0 ? chosenDepts : deptPool;

    const subPool = depts.flatMap((d) => d.subdepartments);
    const chosenSubs = subPool.filter((sd) => selection.subdept_ids?.includes(sd.id));
    const subs = chosenSubs.length > 0 ? chosenSubs : subPool;

    const next: ScopeSelection = {
        org_ids: orgs.map((o) => o.id),
        dept_ids: depts.map((d) => d.id),
        subdept_ids: subs.map((sd) => sd.id),
    };
    // Order-insensitive: the saved order is the user's, the tree's order is by name.
    const asSet = (s: ScopeSelection): ScopeSelection => ({
        org_ids: [...(s.org_ids ?? [])].sort(),
        dept_ids: [...(s.dept_ids ?? [])].sort(),
        subdept_ids: [...(s.subdept_ids ?? [])].sort(),
    });
    return sameSelection(asSet(selection), asSet(next)) ? selection : next;
}

/**
 * True when the tree holds exactly one place to work in: one organization, one
 * department, at most one sub-department. The filter then has nothing to offer
 * and is hidden. (A gamma in one sub-department is the usual case; so is a delta
 * whose department has a single sub-department.)
 */
export function offersOnePlace(tree: ScopeTree | null | undefined): boolean {
    const orgs = tree?.organizations ?? [];
    if (orgs.length !== 1) return false;
    const depts = orgs[0].departments;
    return depts.length === 1 && depts[0].subdepartments.length <= 1;
}

/** A stable cache key for React Query. Sorts copies: the selection is state and must not be mutated. */
export function scopeKeyOf(scope: ScopeSelection): string {
    return [
        ...[...scope.org_ids].sort(),
        '|',
        ...[...scope.dept_ids].sort(),
        '|',
        ...[...scope.subdept_ids].sort(),
    ].join(',');
}

/** A saved selection read back from storage, or null when it is not one. */
export function asSelection(value: unknown): ScopeSelection | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const ids = (x: unknown): string[] | null =>
        Array.isArray(x) && x.every((id) => typeof id === 'string') ? (x as string[]) : null;
    const org_ids = ids(v.org_ids);
    const dept_ids = ids(v.dept_ids);
    const subdept_ids = ids(v.subdept_ids);
    if (!org_ids || !dept_ids || !subdept_ids) return null;
    return { org_ids, dept_ids, subdept_ids };
}
