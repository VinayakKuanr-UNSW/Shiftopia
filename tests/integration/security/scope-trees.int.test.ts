/**
 * The global scope filter's places, as each persona's app receives them from
 * `resolve_user_permissions` — built from hr.user_contracts (migration
 * `*_scope_trees_from_contracts`), the table on the Users page.
 *
 *   contracted_scope_tree  personal pages: each active contract's own sub-department
 *   allowed_scope_tree     managerial pages: what gamma-and-above contracts reach
 *   timesheet_scope_tree   Timesheets: that, plus each Team Lead (beta) contract
 *
 * The filter only narrows a view (RLS decides the rows), so these assertions are
 * about what a person is OFFERED: never a place they cannot use, never missing
 * one they can.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { personaClient, type Persona } from '../support/clients';

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000f2';
const D1 = '54c4c466-8d56-41c1-bf36-98ee4d7364f3';
const D2 = 'c0000000-0000-0000-0000-000000000003';
const S1 = '707b57f8-77f5-4751-8bfd-5f652ef84fcd';
const S2 = 'ed004483-7cb4-40cf-a151-57053e009ea8';
const S3 = '6fefad95-9cf9-468c-8724-424cc2f7b640';

interface Tree {
    organizations: Array<{ id: string; departments: Array<{ id: string; subdepartments: Array<{ id: string }> }> }>;
}
interface Places { orgs: string[]; depts: string[]; subs: string[] }

const places = (t: Tree | undefined): Places => {
    const orgs = t?.organizations ?? [];
    return {
        orgs: orgs.map((o) => o.id).sort(),
        depts: orgs.flatMap((o) => o.departments.map((d) => d.id)).sort(),
        subs: orgs.flatMap((o) => o.departments.flatMap((d) => d.subdepartments.map((s) => s.id))).sort(),
    };
};
const NOTHING: Places = { orgs: [], depts: [], subs: [] };

const trees: Partial<Record<Persona, { personal: Places; managerial: Places; timesheet: Places }>> = {};

beforeAll(async () => {
    const all: Persona[] = ['A', 'X', 'B', 'G', 'G2', 'D', 'E', 'F', 'Z'];
    await Promise.all(all.map(async (p) => {
        const { data, error } = await personaClient(p).rpc('resolve_user_permissions');
        if (error) throw new Error(`${p}: ${error.message}`);
        trees[p] = {
            personal: places(data.contracted_scope_tree),
            managerial: places(data.allowed_scope_tree),
            timesheet: places(data.timesheet_scope_tree),
        };
    }));
});

describe('scope trees come from contracts', () => {
    it('no contract ⇒ no places at all (A)', () => {
        expect(trees.A).toEqual({ personal: NOTHING, managerial: NOTHING, timesheet: NOTHING });
    });

    it('an employee (alpha, no certificate) still has a personal scope (X)', () => {
        expect(trees.X!.personal).toEqual({ orgs: [ORG], depts: [D1], subs: [S1] });
        expect(trees.X!.managerial).toEqual(NOTHING);
        expect(trees.X!.timesheet).toEqual(NOTHING);
    });

    it('a Team Lead in S1, staff in S3: both personally, only S1 on Timesheets (B)', () => {
        expect(trees.B!.personal.subs).toEqual([S1, S3].sort());
        expect(trees.B!.timesheet).toEqual({ orgs: [ORG], depts: [D1], subs: [S1] });
        expect(trees.B!.managerial).toEqual(NOTHING);
    });

    it('gamma reaches its own sub-department only (G, G2)', () => {
        expect(trees.G!.managerial).toEqual({ orgs: [ORG], depts: [D1], subs: [S1] });
        expect(trees.G2!.managerial).toEqual({ orgs: [ORG], depts: [D1], subs: [S2] });
        expect(trees.G!.timesheet).toEqual(trees.G!.managerial);
    });

    it('delta reaches its department and every sub-department in it (D)', () => {
        expect(trees.D!.managerial.depts).toEqual([D1]);
        expect(trees.D!.managerial.subs).toEqual(expect.arrayContaining([S1, S2]));
        expect(trees.D!.managerial.subs).not.toContain(S3);
        // Personal pages are about their own work: the one contract, not the reach.
        expect(trees.D!.personal.subs).toEqual([S1]);
    });

    it('epsilon reaches its organization, not another (E, F)', () => {
        expect(trees.E!.managerial.orgs).toEqual([ORG]);
        expect(trees.E!.managerial.depts).toEqual(expect.arrayContaining([D1, D2]));
        expect(trees.F!.managerial.orgs).toEqual([OTHER_ORG]);
    });

    it('zeta reaches every organization; personally only where contracted (Z)', () => {
        expect(trees.Z!.managerial.orgs).toEqual(expect.arrayContaining([ORG, OTHER_ORG]));
        expect(trees.Z!.personal).toEqual({ orgs: [ORG], depts: [D1], subs: [S1] });
    });
});
