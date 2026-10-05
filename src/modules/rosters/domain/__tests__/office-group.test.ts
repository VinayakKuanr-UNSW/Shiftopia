/**
 * Office — the fifth fixed roster group, where full-time shifts live
 * (migrations 20261004160000 / 20261004160100).
 *
 * The roster's groups are hard-coded in dozens of places, and every time one is
 * added some of them are missed. The Cutaway was: for weeks its shifts rendered
 * in the purple fallback wherever a map had only the original three branches.
 * Two maps here were worse than a wrong colour — `ensureGroup` typed any unknown
 * group as `convention_centre`, and `getGroupsModeGrid` NAMED any unknown group
 * "Theatre" — so a missed Office would have shown the wrong shifts under the
 * wrong name, not merely in the wrong colour.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Constants } from '@/platform/supabase/types';
import { ALL_GROUP_TYPES, GROUP_COLORS, GROUP_DISPLAY_NAMES } from '../projections/constants';
import { resolveGroupVariant } from '../shift-ui';
import { getDefaultGroups } from '../queries/getGroupsModeGrid.query';
import { resolveGroupType } from '../../utils/roster-utils';

describe('the client knows every group the database does', () => {
    it('ALL_GROUP_TYPES is exactly the template_group_type enum, in order', () => {
        expect(ALL_GROUP_TYPES).toEqual([...Constants.public.Enums.template_group_type]);
    });

    it('Office has a name and a colour of its own', () => {
        expect(GROUP_DISPLAY_NAMES.office).toBe('Office');
        expect(GROUP_COLORS.office.accent).toBe('cyan');
        // Not any other group's accent, and not the gray of "Unassigned".
        const others = ALL_GROUP_TYPES.filter(t => t !== 'office').map(t => GROUP_COLORS[t].accent);
        expect(others).not.toContain('cyan');
    });
});

describe('the planner draws an Office row, named Office', () => {
    it('getDefaultGroups names every group by its own name', () => {
        // The name was a ternary ending in `: 'Theatre'`.
        const groups = getDefaultGroups();
        expect(groups.map(g => g.type)).toEqual(ALL_GROUP_TYPES);
        expect(groups.find(g => g.type === 'office')?.name).toBe('Office');
        expect(new Set(groups.map(g => g.name)).size).toBe(groups.length);
    });

    it('a cyan card resolves back to the Office group', () => {
        expect(resolveGroupType({ groupColor: 'cyan' })).toBe('office');
        expect(resolveGroupType({ group_type: 'office' })).toBe('office');
    });
});

describe('card theming: Office is decided by the group, and only the group', () => {
    it('an Office shift in a department named after a venue is still Office', () => {
        // The free-text matches run convention-first over department and role
        // names too, so without an explicit group check this would be blue.
        expect(resolveGroupVariant(
            { group_type: 'office', departments: { name: 'Convention Services' } },
        )).toBe('office');
    });

    it('"office" in a role or department name does not make a shift Office', () => {
        expect(resolveGroupVariant({ group_type: 'theatre', roles: { name: 'Box Office' } })).toBe('theatre');
        expect(resolveGroupVariant(
            { group_type: 'convention_centre', departments: { name: 'Front Office' } },
        )).toBe('convention');
    });
});

/**
 * The recurring failure, as a guard: a file that knows about The Cutaway is a
 * file with a per-group map, so it must know about Office too. Comments are
 * stripped first — a comment describing a group is not a map that handles it.
 */
describe('every per-group map that handles The Cutaway also handles Office', () => {
    const SRC = resolve(process.cwd(), 'src');
    const OFFICE = /['"`]office['"`]|\boffice\s*:|['"`]Office['"`]|\bOffice\s*:|>Office<|-office\b/;

    const stripComments = (code: string) =>
        code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p);
            return /\.(ts|tsx)$/.test(name) ? [p] : [];
        });

    const offenders = walk(SRC).filter((p) => {
        const code = stripComments(readFileSync(p, 'utf-8'));
        return /cutaway/i.test(code) && !OFFICE.test(code);
    });

    it('finds the maps it is meant to police', () => {
        // A guard that matches nothing passes vacuously.
        const policed = walk(SRC).filter(p => /cutaway/i.test(stripComments(readFileSync(p, 'utf-8'))));
        expect(policed.length).toBeGreaterThan(20);
    });

    it('has no offenders', () => {
        expect(offenders.map(p => p.slice(SRC.length + 1))).toEqual([]);
    });
});
