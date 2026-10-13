/**
 * The SQL access harnesses in supabase/tests/access_matrix/, run against the
 * stack. Both files run inside BEGIN … ROLLBACK, so they leave nothing behind.
 * access-matrix-http.int.test.ts asserts the same matrix over HTTP; keeping
 * both means a divergence names its layer (database rules vs API exposure).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stack } from '../support/clients';
import { REPO_ROOT, resetFixtures, sqlFileNotices } from '../support/stack';

const DIR = 'supabase/tests/access_matrix';

beforeAll(() => resetFixtures(stack().dbContainer));

describe('SQL access harness', () => {
    it('02_matrix_by_level.sql reproduces expected_matrix.txt', () => {
        const actual = sqlFileNotices(stack().dbContainer, `${DIR}/02_matrix_by_level.sql`).map((l) => l.trimEnd());
        const expected = readFileSync(resolve(REPO_ROOT, `${DIR}/expected_matrix.txt`), 'utf8')
            .split('\n').map((l) => l.trimEnd()).filter(Boolean);
        expect(actual).toEqual(expected);
    });

    it('03_legacy_flag.sql: the retired admin flag grants nothing; zeta keeps broadcast admin', () => {
        expect(sqlFileNotices(stack().dbContainer, `${DIR}/03_legacy_flag.sql`)).toEqual([
            'X(flag=admin, no cert): is_admin=false mgr_or_above=false delta_access=false bcast_sys=false '
            + 'require_scope=denied change_own_flag=refused | Z: bcast_sys=true',
        ]);
    });
});
