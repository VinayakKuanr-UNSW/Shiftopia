/**
 * The casual opportunity-adjusted fairness engine (migrations
 * 20261107030325 + 20261107035312), exercised in the database built from the
 * migrations: category split, opportunity snapshots, recompute and client
 * exposure (the SQL harness, inside BEGIN … ROLLBACK), then who can read a
 * ledger row over HTTP.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { personaClient, personaId, stack, type Persona } from '../support/clients';
import { psql, resetFixtures, sqlFileNotices } from '../support/stack';

const ORG = '00000000-0000-0000-0000-000000000001';

describe('casual fairness engine', () => {
    it('casual_fairness_engine.sql passes every section', () => {
        const notices = sqlFileNotices(stack().dbContainer, 'supabase/tests/casual_fairness_engine.sql');
        expect(notices).toEqual([
            'category minutes: OK',
            'capture: OK',
            'recompute: OK',
            'exposure: OK',
            'casual fairness engine: OK',
        ]);
    });
});

describe('casual fairness ledger: who can read a row', () => {
    beforeAll(() => {
        resetFixtures(stack().dbContainer);
        // X is a casual in sub-department S1.
        psql(stack().dbContainer, `
            DELETE FROM public.casual_fairness_ledger WHERE organization_id = '${ORG}';
            INSERT INTO public.casual_fairness_ledger
                (organization_id, employee_id, metric, window_start, window_end, actual_hours,
                 expected_hours, debt_hours, opportunity_count, confidence, run_id)
            VALUES ('${ORG}', '${personaId('X')}', 'sunday_hours', '2026-11-07', '2026-12-31',
                    16, 20, -4, 4, 0.4, gen_random_uuid());`);
    });
    afterAll(() => {
        psql(stack().dbContainer, `DELETE FROM public.casual_fairness_ledger WHERE organization_id = '${ORG}';`);
    });

    const visibleRows = async (p: Persona): Promise<number> => {
        const { data, error } = await personaClient(p)
            .from('casual_fairness_ledger').select('employee_id').eq('employee_id', personaId('X'));
        expect(error).toBeNull();
        return data?.length ?? 0;
    };

    it.each<[Persona, number, string]>([
        ['X', 1, 'the employee themselves'],
        ['G', 1, 'a gamma in their sub-department'],
        ['D', 1, 'a delta over their department'],
        ['G2', 0, 'a gamma in a sibling sub-department'],
        ['A', 0, 'someone with no contract'],
        ['F', 0, 'an epsilon in another organization'],
    ])('%s sees %i row(s): %s', async (p, expected) => {
        expect(await visibleRows(p)).toBe(expected);
    });

    it('nobody can write to it', async () => {
        const { error } = await personaClient('Z').from('casual_fairness_ledger')
            .update({ debt_hours: 0 }).eq('employee_id', personaId('X')).select();
        expect(error?.code).toBe('42501');
    });
});
