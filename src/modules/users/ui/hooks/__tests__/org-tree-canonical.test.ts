import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../../..');

function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            out.push(...walkTsFiles(full));
        } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('canonical public org tree (Wave 2 unification)', () => {
    it('no runtime code under src/ or supabase/functions/ queries retired hr.departments or hr.subdepartments', () => {
        const files = [
            ...walkTsFiles(join(REPO_ROOT, 'src')),
            ...walkTsFiles(join(REPO_ROOT, 'supabase/functions')),
        ];
        const offenders: string[] = [];
        for (const file of files) {
            const code = stripComments(readFileSync(file, 'utf8'));
            if (
                /\.schema\(\s*['"]hr['"]\s*\)\s*\.from\(\s*['"](?:departments|subdepartments)['"]\s*\)/.test(code) ||
                /\bhr\s*\.\s*from\(\s*['"](?:departments|subdepartments)['"]\s*\)/.test(code) ||
                /\.from\(\s*['"]subdepartments['"]\s*\)/.test(code)
            ) {
                offenders.push(file.slice(REPO_ROOT.length + 1));
            }
        }
        expect(offenders).toEqual([]);
    });

    it('useReferenceData, shifts.queries, and get-roster-view query canonical public.departments and public.sub_departments', () => {
        const refData = stripComments(readFileSync(join(REPO_ROOT, 'src/modules/users/ui/hooks/useReferenceData.ts'), 'utf8'));
        expect(refData).toMatch(/supabase\.from\(\s*['"]departments['"]\s*\)/);
        expect(refData).toMatch(/supabase\.from\(\s*['"]sub_departments['"]\s*\)/);

        const shiftsQueries = stripComments(readFileSync(join(REPO_ROOT, 'src/modules/rosters/api/shifts.queries.ts'), 'utf8'));
        expect(shiftsQueries).toMatch(/supabase\.from\(\s*['"]departments['"]\s*\)\.select\(\s*['"]id['"]\s*\)\.eq\(\s*['"]organization_id['"]/);
        expect(shiftsQueries).toMatch(/supabase\.from\(\s*['"]sub_departments['"]\s*\)\.select\(\s*['"]id['"]\s*\)\.eq\(\s*['"]department_id['"]/);

        const rosterView = stripComments(readFileSync(join(REPO_ROOT, 'supabase/functions/get-roster-view/index.ts'), 'utf8'));
        expect(rosterView).toMatch(/supabase\.from\(\s*['"]departments['"]\s*\)\.select\(\s*['"]id['"]\s*\)\.eq\(\s*['"]organization_id['"]/);
        expect(rosterView).toMatch(/supabase\.from\(\s*['"]sub_departments['"]\s*\)\.select\(\s*['"]id['"]\s*\)\.eq\(\s*['"]department_id['"]/);
    });
});
