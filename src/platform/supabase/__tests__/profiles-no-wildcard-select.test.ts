/**
 * `authenticated` cannot SELECT profiles.phone / date_of_birth /
 * emergency_contact_name / emergency_contact_phone (column grants), so any
 * `*` read of profiles, direct or embedded, fails the whole query with 42501.
 * auth.service treats 42501 as a rejected credential and ends the session, so
 * one wildcard read logs every user out. Read own contact data through
 * get_my_private_profile() instead.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SCAN = ['src', 'supabase/functions'];
const SKIP = /(__tests__|node_modules|_retired|platform\/supabase\/types\.ts$)/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (SKIP.test(path)) return [];
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

// Comments mention `profiles(*)` when explaining the rule; only code counts.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WILDCARD_READS = [
    /from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*['"`]\s*\*\s*['"`]/,
    /profiles(![a-z_]+)?\s*\(\s*\*\s*\)/,
];

describe('profiles reads', () => {
    it('never select * from profiles, directly or embedded', () => {
        const offenders = SCAN.flatMap((d) => sourceFiles(join(ROOT, d)))
            .filter((file) => {
                const code = stripComments(readFileSync(file, 'utf8'));
                return WILDCARD_READS.some((re) => re.test(code));
            })
            .map((file) => relative(ROOT, file));

        expect(offenders).toEqual([]);
    });
});
