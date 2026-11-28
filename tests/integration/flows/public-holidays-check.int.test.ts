/**
 * Automated official public holiday verification (migration
 * *_public_holidays_official_check; docs/architecture/multi-organization.md §13):
 * runs supabase/tests/holidays/01_official_check.sql (BEGIN … ROLLBACK) against
 * the local stack and compares its NOTICE lines.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { REPO_ROOT, resetFixtures, sqlFileNotices } from '../support/stack';

beforeAll(() => resetFixtures(stack().dbContainer));

describe('public holidays official check', () => {
    it('01_official_check.sql reproduces expected_official_check.txt', () => {
        const actual = sqlFileNotices(stack().dbContainer, 'supabase/tests/holidays/01_official_check.sql').map((l) => l.trimEnd());
        const expected = readFileSync(resolve(REPO_ROOT, 'supabase/tests/holidays/expected_official_check.txt'), 'utf8')
            .split('\n').map((l) => l.trimEnd()).filter(Boolean);
        expect(actual).toEqual(expected);
    });
});
