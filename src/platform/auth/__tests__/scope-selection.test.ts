import { describe, expect, it } from 'vitest';
import {
    asSelection,
    defaultSelectionFromTree,
    offersOnePlace,
    reconcileScope,
    scopeKeyOf,
    scopeTreeFor,
} from '../scope-selection';
import type { PermissionObject, ScopeSelection, ScopeTree } from '../types';

const tree = (orgs: Array<[string, Array<[string, string[]]>]>): ScopeTree => ({
    organizations: orgs.map(([o, depts]) => ({
        id: o, name: o,
        departments: depts.map(([d, subs]) => ({
            id: d, name: d,
            subdepartments: subs.map((s) => ({ id: s, name: s })),
        })),
    })),
});

// ICC: Event Delivery (Bar, Kitchen), Building Services (Cleaning).
const ICC = tree([['icc', [['delivery', ['bar', 'kitchen']], ['building', ['cleaning']]]]]);

const sel = (org_ids: string[], dept_ids: string[], subdept_ids: string[]): ScopeSelection =>
    ({ org_ids, dept_ids, subdept_ids });

const perms = (over: Partial<PermissionObject>): PermissionObject => ({
    typeX: [], typeY: null, allowed_scope_tree: { organizations: [] }, ...over,
});

describe('scopeTreeFor — every tree comes from the contracts', () => {
    const P = perms({
        contracted_scope_tree: tree([['icc', [['delivery', ['bar', 'kitchen']]]]]),
        allowed_scope_tree: tree([['icc', [['delivery', ['bar']]]]]),
        timesheet_scope_tree: tree([['icc', [['delivery', ['bar', 'kitchen']]]]]),
    });

    it('personal reads the contracted tree, never the Type X certificates', () => {
        // No Type X at all (an alpha): the personal tree is still there.
        expect(scopeTreeFor(P, 'personal')).toBe(P.contracted_scope_tree);
    });

    it('managerial reads the gamma-and-above tree', () => {
        expect(scopeTreeFor(P, 'managerial')).toBe(P.allowed_scope_tree);
    });

    it('timesheet reads its own tree, which adds Team Lead sub-departments', () => {
        expect(scopeTreeFor(P, 'timesheet')).toBe(P.timesheet_scope_tree);
    });

    it('timesheet falls back to the managerial tree on an older server', () => {
        const old = perms({ allowed_scope_tree: ICC });
        expect(scopeTreeFor(old, 'timesheet')).toBe(ICC);
    });

    it('is null while permissions are unknown, and personal is null without a contracted tree', () => {
        expect(scopeTreeFor(null, 'managerial')).toBeNull();
        expect(scopeTreeFor(perms({}), 'personal')).toBeNull();
    });
});

describe('reconcileScope — a saved choice is kept to what the contracts reach', () => {
    it('no saved choice ⇒ everything', () => {
        expect(reconcileScope(null, ICC)).toEqual(defaultSelectionFromTree(ICC));
    });

    it('a choice from someone else, or from a contract since ended ⇒ everything', () => {
        expect(reconcileScope(sel(['other-org'], ['x'], ['y']), ICC)).toEqual(defaultSelectionFromTree(ICC));
    });

    it('keeps the valid part and drops a sub-department no longer reached', () => {
        const saved = sel(['icc'], ['delivery'], ['bar', 'gone']);
        expect(reconcileScope(saved, ICC)).toEqual(sel(['icc'], ['delivery'], ['bar']));
    });

    it('drops a sub-department that is not under a chosen department', () => {
        // Cleaning belongs to Building Services, which is not chosen.
        const saved = sel(['icc'], ['delivery'], ['bar', 'cleaning']);
        expect(reconcileScope(saved, ICC)).toEqual(sel(['icc'], ['delivery'], ['bar']));
    });

    it('a level left empty, or emptied by the tree, means all of it', () => {
        expect(reconcileScope(sel(['icc'], ['delivery'], []), ICC))
            .toEqual(sel(['icc'], ['delivery'], ['bar', 'kitchen']));
        expect(reconcileScope(sel(['icc'], ['gone'], ['gone']), ICC))
            .toEqual(defaultSelectionFromTree(ICC));
    });

    it('returns the saved object itself when it is already valid, in any order', () => {
        const saved = sel(['icc'], ['building', 'delivery'], ['kitchen', 'bar', 'cleaning']);
        expect(reconcileScope(saved, ICC)).toBe(saved);
    });

    it('an empty tree (no contract in this mode) ⇒ an empty scope', () => {
        expect(reconcileScope(sel(['icc'], [], []), { organizations: [] })).toEqual(sel([], [], []));
    });
});

describe('offersOnePlace — when the filter has nothing to offer', () => {
    it('one organization, one department, one sub-department', () => {
        expect(offersOnePlace(tree([['icc', [['delivery', ['bar']]]]]))).toBe(true);
    });

    it('two sub-departments, or two departments, is a choice', () => {
        expect(offersOnePlace(tree([['icc', [['delivery', ['bar', 'kitchen']]]]]))).toBe(false);
        expect(offersOnePlace(ICC)).toBe(false);
    });

    it('an empty or missing tree is not "locked"', () => {
        expect(offersOnePlace({ organizations: [] })).toBe(false);
        expect(offersOnePlace(null)).toBe(false);
    });
});

describe('scopeKeyOf', () => {
    it('is order-insensitive and does not reorder the selection it was given', () => {
        const s = sel(['b', 'a'], ['d2', 'd1'], ['s2', 's1']);
        expect(scopeKeyOf(s)).toBe(scopeKeyOf(sel(['a', 'b'], ['d1', 'd2'], ['s1', 's2'])));
        // It used to sort the state arrays in place.
        expect(s).toEqual(sel(['b', 'a'], ['d2', 'd1'], ['s2', 's1']));
    });
});

describe('asSelection — what storage gives back', () => {
    it('accepts a selection', () => {
        expect(asSelection(sel(['a'], [], ['s']))).toEqual(sel(['a'], [], ['s']));
    });

    it.each([null, 'x', 7, {}, { org_ids: ['a'] }, { org_ids: [1], dept_ids: [], subdept_ids: [] }])(
        'rejects %j',
        (v) => expect(asSelection(v)).toBeNull(),
    );
});
