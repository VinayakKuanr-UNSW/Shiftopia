/**
 * Venue time (migration *_venue_timezones; docs/architecture/multi-organization.md §9):
 * a shift's timezone is its organization's, its instants are that venue's wall
 * clock, and "today" is the venue's date. Runs supabase/tests/time/01_venue_time.sql
 * (BEGIN … ROLLBACK) against the stack and compares its NOTICE lines.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { REPO_ROOT, resetFixtures, sqlFileNotices } from '../support/stack';

beforeAll(() => resetFixtures(stack().dbContainer));

describe('venue time', () => {
    it('01_venue_time.sql reproduces expected_venue_time.txt', () => {
        const actual = sqlFileNotices(stack().dbContainer, 'supabase/tests/time/01_venue_time.sql').map((l) => l.trimEnd());
        const expected = readFileSync(resolve(REPO_ROOT, 'supabase/tests/time/expected_venue_time.txt'), 'utf8')
            .split('\n').map((l) => l.trimEnd()).filter(Boolean);
        expect(actual).toEqual(expected);
    });
});
