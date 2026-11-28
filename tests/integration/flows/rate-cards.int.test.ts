/**
 * Rate cards per period (migration *_rate_cards_per_period;
 * docs/architecture/multi-organization.md §11): the Administrator rolls a card
 * forward into a draft, publishes or discards it; drafts stay hidden and price
 * nothing; published periods never overlap. Runs supabase/tests/pay/01_rate_cards.sql
 * (BEGIN … ROLLBACK) against the stack and compares its NOTICE lines.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { REPO_ROOT, resetFixtures, sqlFileNotices } from '../support/stack';

beforeAll(() => resetFixtures(stack().dbContainer));

describe('rate cards', () => {
    it('01_rate_cards.sql reproduces expected_rate_cards.txt', () => {
        const actual = sqlFileNotices(stack().dbContainer, 'supabase/tests/pay/01_rate_cards.sql').map((l) => l.trimEnd());
        const expected = readFileSync(resolve(REPO_ROOT, 'supabase/tests/pay/expected_rate_cards.txt'), 'utf8')
            .split('\n').map((l) => l.trimEnd()).filter(Boolean);
        expect(actual).toEqual(expected);
    });
});
