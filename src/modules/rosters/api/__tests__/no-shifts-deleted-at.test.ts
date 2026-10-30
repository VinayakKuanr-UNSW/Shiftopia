import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Shifts are never soft-deleted: CHECK shifts_no_soft_delete keeps
 * `shifts.deleted_at` NULL on every row, and the column is being dropped
 * (docs/handover/2026-10-30-shifts-table-plan.md, Phase 2). `shifts` is the only
 * table with that column, so any `deleted_at` in a query is a shifts filter that
 * never filters anything, and once the column is gone it fails the whole select.
 *
 * `roster_date` (Phase 3) is the same kind of column: written on every insert,
 * never read, and left stale when a shift moves to another day, so it is being
 * dropped too.
 *
 * Scans the app and the edge functions with comments stripped. The generated
 * `types.ts` is regenerated after the drop.
 */

const ROOTS = ['src', 'supabase/functions'].map((dir) => resolve(process.cwd(), dir));
const SKIP_DIRS = new Set(['__tests__', 'node_modules']);
const ALLOWED = new Set(['src/platform/supabase/types.ts']);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

const stripComments = (code: string) =>
    code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('nothing reads or writes the dropped shifts columns', () => {
    const files = ROOTS.flatMap(sourceFiles);

    it('scans the source tree (guards against an empty walk)', () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it('no source file names deleted_at or roster_date', () => {
        const offenders = files
            .map((path) => relative(process.cwd(), path))
            .filter((rel) => !ALLOWED.has(rel))
            .filter((rel) => /\b(deleted_at|roster_date)\b/.test(stripComments(readFileSync(rel, 'utf8'))));
        expect(offenders).toEqual([]);
    });
});
