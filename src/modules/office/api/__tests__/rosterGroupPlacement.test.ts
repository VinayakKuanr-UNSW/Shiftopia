/**
 * A baseline shift has to land in a group the Roster Planner draws.
 *
 * `shifts.roster_subgroup_id` is the structural link and is NOT NULL, so a
 * shift written without `group_type` is correctly parented — and invisible.
 * `GroupModeView` buckets its cells with `cell.group_type === group.type`, so
 * a null there matches nothing, not even "Unassigned".
 *
 * That is exactly what happened: 39 shifts were created, sat in the right
 * roster under "Convention Centre / AM Base", and the planner showed
 * "0/0 filled" on every group.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normaliseGroupName } from '../rosterTarget';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/** The labels of the Postgres enum `template_group_type`, in order. */
const ENUM_LABELS = ['convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway', 'office'];

describe('normaliseGroupName', () => {
    it('turns each real group name into its enum label', () => {
        // `shifts.group_type` IS that enum, so anything else is a 22P02 on write.
        expect(ENUM_LABELS).toEqual([
            'Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway', 'Office',
        ].map(normaliseGroupName));
    });

    it('agrees with the transform the planner builds its group list from', () => {
        // getRosterStructure: group.name.toLowerCase().replace(/\s+/g, '_')
        const asPlannerDoesIt = (n: string) => n.toLowerCase().replace(/\s+/g, '_');
        for (const name of ['Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway', 'Office']) {
            expect(normaliseGroupName(name)).toBe(asPlannerDoesIt(name));
        }
    });

    it('collapses runs of whitespace rather than leaving a double underscore', () => {
        expect(normaliseGroupName('The  Cutaway')).toBe('the_cutaway');
    });
});

describe('Apply carries the group identity', () => {
    it('resolveRosterTarget returns the group, not only the subgroup id', () => {
        const src = read('src/modules/office/api/rosterTarget.ts');
        expect(src).toContain('groupType: string;');
        expect(src).toContain('subGroupName: string;');
    });

    it('applyOffice passes both to createShift', () => {
        // Without these two lines the shifts are written, parented, and
        // invisible — the failure this file exists to prevent recurring.
        const src = read('src/modules/office/api/office.commands.ts');
        expect(src).toContain('group_type: target.groupType');
        expect(src).toContain('sub_group_name: target.subGroupName');
    });

    it('the create payload can name every fixed group', () => {
        // `CreateShiftData.group_type` once listed three; `the_cutaway` was
        // missing, so one of the roster's fixed groups could not be named at all.
        const src = read('src/modules/rosters/model/shift.types.ts');
        expect(src).toContain('group_type?: TemplateGroupType;');
    });
});

/**
 * Where an Office shift is parented, and the trigger that decides it.
 *
 * `roster_groups` has a live BEFORE INSERT trigger — `enforce_exactly_three
 * _groups`, misleading name, five values — which RAISEs unless `external_id` is
 * one of the five fixed groups, NULL included. So this module must never
 * insert a group. It used to: a `roster_groups` insert with a `name` and no
 * `external_id`, guaranteed to fail the moment it was reached. It survived
 * unnoticed because the branch before it took any subgroup that already existed.
 */
describe('Office shifts are parented under Office / Administration', () => {
    const src = read('src/modules/office/api/rosterTarget.ts');

    it('never inserts a roster GROUP — the trigger would reject it', () => {
        expect(src).not.toMatch(/from\(['"]roster_groups['"]\)[\s\S]{0,200}?\.insert\(/);
    });

    it('creates only the subgroup, which has no trigger on it', () => {
        expect(src).toMatch(/from\(['"]roster_subgroups['"]\)[\s\S]{0,120}?\.insert\(/);
    });

    it('resolves the group by external_id, not by its protected name', () => {
        // external_id is the key the enforcing trigger itself checks. It was
        // 'convention_centre' until Office became a fixed group of its own.
        expect(src).toContain("const OFFICE_GROUP_EXTERNAL_ID = 'office'");
        expect(src).toMatch(/\.eq\(['"]external_id['"],\s*OFFICE_GROUP_EXTERNAL_ID\)/);
    });

    it('uses one named subgroup rather than whatever it finds first', () => {
        // The old fallback ("any subgroup at all") is why all 39 production rows
        // landed in `AM Base`, a subgroup made for something else entirely.
        expect(src).toContain("const OFFICE_SUBGROUP_NAME = 'Administration'");
        expect(src).not.toMatch(/Any subgroup at all/i);
    });

    it('supplies the two NOT NULL headcount columns when it creates one', () => {
        // Both are NOT NULL with no default, so omitting them is a 23502.
        expect(src).toMatch(/required_headcount:\s*0/);
        expect(src).toMatch(/min_headcount:\s*0/);
    });
});
