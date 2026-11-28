/**
 * Wave 2 org-tree unification (migration *_org_tree_departments_unification;
 * docs/architecture/multi-organization.md §14):
 * runs supabase/tests/org_tree/01_departments_unification.sql (BEGIN … ROLLBACK)
 * against the local stack and compares its NOTICE lines.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { REPO_ROOT, resetFixtures, sqlFileNotices } from '../support/stack';

beforeAll(() => resetFixtures(stack().dbContainer));

describe('org tree departments & sub_departments unification', () => {
    it('01_departments_unification.sql reproduces expected_departments_unification.txt', () => {
        const actual = sqlFileNotices(stack().dbContainer, 'supabase/tests/org_tree/01_departments_unification.sql').map((l) => l.trimEnd());
        const expected = readFileSync(resolve(REPO_ROOT, 'supabase/tests/org_tree/expected_departments_unification.txt'), 'utf8')
            .split('\n').map((l) => l.trimEnd()).filter(Boolean);
        expect(actual).toEqual(expected);
    });
});
