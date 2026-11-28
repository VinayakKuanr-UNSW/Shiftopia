/**
 * ICC Sydney's two published cards, as the AutoScheduler reads them
 * (fetchPublishedRateCardSchedules). Built from the embedded schedule, which
 * rate-card-resolver.test.ts proves equal to the seeded cards — so a test
 * mocking the fetch with these prices exactly as ICC's live cards do.
 */
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';
import { RATE_SCHEDULE } from '@/modules/rosters/domain/projections/utils/cost/rate-schedule';
import type { PricedCard } from '@/modules/rosters/domain/projections/utils/cost/rate-card-resolver';

export const ICC_TEST_CARDS: PricedCard[] = [
  { code: 'ICC-EA-2025', validFrom: '2025-01-01', validTo: '2026-07-05', rateSet: RATE_SCHEDULE[0], loadings: ICC_SYDNEY_EA_LOADINGS, trainee: null },
  { code: 'ICC-EA-2026-27', validFrom: '2026-07-06', validTo: null, rateSet: RATE_SCHEDULE[1], loadings: ICC_SYDNEY_EA_LOADINGS, trainee: null },
];

/** vi.mock factory body: every organization asked for gets ICC's cards. */
export const iccRateCardsModule = {
  fetchPublishedRateCardSchedules: async (ids: readonly string[]) => new Map(ids.map((id) => [id, ICC_TEST_CARDS])),
};
