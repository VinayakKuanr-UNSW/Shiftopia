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
const ENUM_LABELS = ['convention_centre', 'exhibition_centre', 'theatre', 'the_cutaway'];

describe('normaliseGroupName', () => {
    it('turns each real group name into its enum label', () => {
        // `shifts.group_type` IS that enum, so anything else is a 22P02 on write.
        expect(ENUM_LABELS).toEqual([
            'Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway',
        ].map(normaliseGroupName));
    });

    it('agrees with the transform the planner builds its group list from', () => {
        // getRosterStructure: group.name.toLowerCase().replace(/\s+/g, '_')
        const asPlannerDoesIt = (n: string) => n.toLowerCase().replace(/\s+/g, '_');
        for (const name of ['Convention Centre', 'Exhibition Centre', 'Theatre', 'The Cutaway']) {
            expect(normaliseGroupName(name)).toBe(asPlannerDoesIt(name));
        }
    });

    it('collapses runs of whitespace rather than leaving a double underscore', () => {
        expect(normaliseGroupName('The  Cutaway')).toBe('the_cutaway');
    });
});

describe('Apply carries the group identity', () => {
    it('resolveRosterTarget returns the group, not only the subgroup id', () => {
        const src = read('src/modules/baseline-ft/api/rosterTarget.ts');
        expect(src).toContain('groupType: string;');
        expect(src).toContain('subGroupName: string;');
    });

    it('applyBaseline passes both to createShift', () => {
        // Without these two lines the shifts are written, parented, and
        // invisible — the failure this file exists to prevent recurring.
        const src = read('src/modules/baseline-ft/api/baselineFt.commands.ts');
        expect(src).toContain('group_type: target.groupType');
        expect(src).toContain('sub_group_name: target.subGroupName');
    });

    it('the create payload can name all four groups', () => {
        // `CreateShiftData.group_type` listed three; `the_cutaway` was missing,
        // so one of the roster's four fixed groups could not be named at all.
        const src = read('src/modules/rosters/model/shift.types.ts');
        expect(src).toContain('group_type?: TemplateGroupType;');
    });
});
