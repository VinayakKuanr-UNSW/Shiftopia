import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every clock a user sees is Australia/Sydney, whatever the viewer's zone.
 * `formatClockTime` / `formatShiftTime` / `formatInTimezone` in
 * `core/lib/date.utils.ts` are the formatters; this fails on the three ways a
 * screen has got it wrong before:
 *
 *  - `toLocaleTimeString(...)` with no `timeZone` — the browser's zone.
 *  - date-fns `format(new Date(x) | parseISO(x), '<time pattern>')` — also the
 *    browser's zone (date-fns formats local fields).
 *  - `split('T')[1]` on a timestamp — the UTC wall-clock, never converted
 *    (the "clocked in at 00:25" bug).
 *
 * Reads source with comments stripped, so prose describing the old bugs does
 * not trip it. `date.utils.ts` is the one sanctioned implementation.
 */

const SRC = resolve(process.cwd(), 'src');
const ALLOWED = new Set(['src/modules/core/lib/date.utils.ts']);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

const stripComments = (code: string) =>
    code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

const RULES: Array<[string, RegExp]> = [
    ['toLocaleTimeString without timeZone', /\.toLocaleTimeString\((?![^)]*timeZone)[^)]*\)/],
    ['date-fns format() of a parsed timestamp with a time pattern',
        /\bformat\(\s*(?:new Date|parseISO)\([^()]*\)\s*,\s*['"`][^'"`]*(?:HH|hh|H:mm|h:mm|mm a)[^'"`]*['"`]/],
    ["split('T')[1] — the UTC wall-clock of a timestamp", /split\(\s*['"]T['"]\s*\)\s*\[\s*1\s*\]/],
];

describe('no screen formats a clock in the browser zone', () => {
    const files = sourceFiles(SRC);

    it('scans the source tree (guards against an empty walk)', () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it.each(RULES)('%s', (_label, pattern) => {
        const offenders = files
            .map((path) => relative(process.cwd(), path))
            .filter((rel) => !ALLOWED.has(rel))
            .filter((rel) => pattern.test(stripComments(readFileSync(rel, 'utf8'))));
        expect(offenders).toEqual([]);
    });
});
