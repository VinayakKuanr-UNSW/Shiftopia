/**
 * Rosters has no copy of any kind — not a shift, not a sub-group, not a group.
 *
 * Copying lives in Templates only (copy a template, a sub-group, a shift). A
 * roster shift that needs repeating is authored in a template and applied, so
 * every roster shift arrives unassigned, through one path, under the template's
 * shape rules. Rosters used to offer three copies: "Clone Shift" in all four
 * modes, "Copy to…" on full-time shifts (which copied the EMPLOYEE onto every
 * date), and "Clone" on a sub-group (clone_roster_subgroup_v2).
 *
 * Reads the source with comments stripped, so a comment describing the old
 * behaviour cannot satisfy or fail it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/modules/rosters', 'src/modules/office'].map((p) => resolve(process.cwd(), p));

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

const stripComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const BANNED = [
    'handleCloneShift', 'onCloneShift',
    'CopyShiftFlow', 'CopyShiftDialog', 'copyShiftToDates', 'openCopyShift',
    'CloneSubGroupDialog', 'useCloneSubGroup', 'cloneRosterSubgroup',
    'describeSubgroupClone', 'clone_roster_subgroup_v2',
    'Clone Shift', 'Copy to…',
];

describe('Rosters offers no copy', () => {
    const files = ROOTS.flatMap(sourceFiles);

    it('finds the source it is guarding', () => {
        expect(files.length).toBeGreaterThan(50);
    });

    it.each(BANNED)('no roster source mentions %s', (token) => {
        const hits = files.filter((f) => stripComments(readFileSync(f, 'utf8')).includes(token));
        expect(hits.map((f) => f.slice(process.cwd().length + 1))).toEqual([]);
    });
});
