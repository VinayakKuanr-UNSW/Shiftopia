/**
 * The Team Availability fairness overlay reads each organization's casual
 * ledger. One organization failing must not blank the others, and a person
 * with standings in several organizations gets them summed, not overwritten.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FairnessStanding } from '@/modules/rosters/domain/fairness-ledger';

const ORG_OK = '11111111-1111-4111-8111-111111111111';
const ORG_TWO = '22222222-2222-4222-8222-222222222222';
const ORG_DOWN = '33333333-3333-4333-8333-333333333333';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ orgId: string; ids: string[] | null }> }));

const standing = (employeeId: string, over: Partial<FairnessStanding>): FairnessStanding => ({
    employeeId, metric: 'sunday_hours', actualHours: 0, expectedHours: 0, debtHours: 0,
    opportunityCount: 1, confidence: 0.1, windowStart: '2026-11-07', windowEnd: '2026-12-01', ...over,
});

vi.mock('@/platform/supabase/client', () => ({ supabase: {} }));
vi.mock('@/modules/rosters/services/fairnessLedger.service', () => ({
    fairnessLedgerService: {
        getStandingsWithStatus: vi.fn(async (orgId: string, ids: string[] | null) => {
            calls.push({ orgId, ids });
            if (orgId === ORG_DOWN) throw new Error('boom');
            const rows = orgId === ORG_OK
                ? [standing(ALICE, { debtHours: -4, opportunityCount: 4 }), standing('someone-else', { debtHours: 9 })]
                : [standing(ALICE, { debtHours: 2, opportunityCount: 3 }), standing(BOB, { debtHours: 1, opportunityCount: 2 })];
            return { standings: rows, status: 'ok', windowEnd: '2026-12-01', ageDays: 0 };
        }),
    },
}));

import { getTeamFairnessStanding } from '../team-availability.api';

describe('getTeamFairnessStanding', () => {
    it('keeps the organizations that answered, merges a person across organizations, and reads org-wide', async () => {
        const out = await getTeamFairnessStanding(
            { org_ids: [ORG_OK, ORG_DOWN, ORG_TWO] } as never,
            [ALICE, BOB],
        );

        expect(calls.every(c => c.ids === null)).toBe(true);
        expect([...out.keys()].sort()).toEqual([ALICE, BOB]);
        expect(out.get(ALICE)?.byMetric.sunday_hours).toEqual({ debtHours: -2, confidence: 0.7, opportunityCount: 7 });
        expect(out.get(BOB)?.byMetric.sunday_hours).toEqual({ debtHours: 1, confidence: 0.2, opportunityCount: 2 });
    });
});
