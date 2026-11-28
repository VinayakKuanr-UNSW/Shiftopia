/**
 * rateCards.api — the rate-card API adapter. Network-free:
 * `@/platform/supabase/client` is mocked; each test sets what the query
 * builder and `rpc` resolve to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const builder: Record<string, any> = {};
  const result = { data: null as unknown, error: null as unknown };
  for (const m of ['select', 'eq', 'order']) builder[m] = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { builder, result, from: vi.fn(() => builder), rpc: vi.fn() };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  ICC_SYDNEY_EA_LOADINGS, RATE_CARD_LOADINGS_SELECT,
} from '@/modules/rosters/domain/projections/utils/cost/loadings';
import {
  RATE_CARD_SELECT, discardRateCard, listRateCards, publishRateCard, rateCardErrorMessage, rollRateCardForward,
} from '../data/rateCards.api';

/** ICC's loadings as the database row PostgREST returns (snake_case, numerics as strings). */
const ICC_LOADINGS_ROW = Object.fromEntries(Object.entries(ICC_SYDNEY_EA_LOADINGS).map(([k, v]) =>
  [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), String(v)]));

beforeEach(() => {
  vi.clearAllMocks();
  h.result.data = null;
  h.result.error = null;
});

describe('listRateCards', () => {
  it('reads the organization\'s cards, drafts included, oldest period first', async () => {
    h.result.data = [{
      id: 'c1', code: 'ICC-EA-2026-27', name: 'ICC 2026–27', valid_from: '2026-07-06', valid_to: null,
      status: 'published', derivation: null, published_at: '2026-11-28T00:00:00Z',
      eba_rate: [{ classification: 'LEVEL_2', employment_basis: 'casual', ordinary_hourly_rate: '30.10', paid_hourly_rate: '37.63' }],
      eba_allowance: [{ code: 'meal', amount: '18.4', unit: 'per_occasion' }],
      pay_rate_card_loadings: ICC_LOADINGS_ROW,
    }, {
      id: 'c2', code: 'ICC-EA-2027-28', name: 'ICC 2027–28', valid_from: '2027-07-05', valid_to: null,
      status: 'draft', derivation: 'ICC-EA-2026-27 × 1.042', published_at: null, eba_rate: [], eba_allowance: [],
      pay_rate_card_loadings: null,
    }];

    const cards = await listRateCards('org-1');

    expect(h.from).toHaveBeenCalledWith('pay_rate_cards');
    expect(h.builder.select).toHaveBeenCalledWith(RATE_CARD_SELECT);
    expect(h.builder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    // No status filter: drafts come back to payroll.manage holders (RLS decides).
    expect(h.builder.eq).toHaveBeenCalledTimes(1);
    expect(h.builder.order).toHaveBeenCalledWith('valid_from', { ascending: true });
    expect(cards[0]).toEqual({
      id: 'c1', code: 'ICC-EA-2026-27', name: 'ICC 2026–27', validFrom: '2026-07-06', validTo: null,
      status: 'published', derivation: null, publishedAt: '2026-11-28T00:00:00Z',
      rates: [{ classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 30.1, paidHourlyRate: 37.63 }],
      allowances: [{ code: 'meal', amount: 18.4, unit: 'per_occasion' }],
      loadings: ICC_SYDNEY_EA_LOADINGS,
    });
    expect(cards[1]).toMatchObject({ status: 'draft', derivation: 'ICC-EA-2026-27 × 1.042', loadings: null });
  });

  it('selects every loadings column the pay engine reads', () => {
    expect(RATE_CARD_SELECT).toContain(`pay_rate_card_loadings(${RATE_CARD_LOADINGS_SELECT})`);
  });

  it('returns nothing without an organization, and asks nobody', async () => {
    expect(await listRateCards(null)).toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('throws on a read error instead of posing as "no cards"', async () => {
    h.result.error = { code: '42703', message: 'column does not exist' };
    await expect(listRateCards('org-1')).rejects.toMatchObject({ code: '42703' });
  });
});

describe('the three RPCs', () => {
  it('roll forward sends trimmed values under the API\'s parameter names and returns the draft id', async () => {
    h.rpc.mockResolvedValue({ data: 'draft-1', error: null });
    const id = await rollRateCardForward({
      sourceCardId: 'c1', code: ' ICC-EA-2027-28 ', name: ' ICC 2027–28 ', validFrom: '2027-07-05', multiplier: 1.042,
    });
    expect(id).toBe('draft-1');
    expect(h.rpc).toHaveBeenCalledWith('roll_rate_card_forward', {
      p_source_card_id: 'c1', p_code: 'ICC-EA-2027-28', p_name: 'ICC 2027–28', p_valid_from: '2027-07-05', p_multiplier: 1.042,
    });
  });

  it('publish and discard name the card', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await publishRateCard('d1');
    await discardRateCard('d2');
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'publish_rate_card', { p_card_id: 'd1' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'discard_rate_card', { p_card_id: 'd2' });
  });

  it('a refusal is thrown with its SQLSTATE', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'rate card not found, or payroll.manage not held' } });
    await expect(publishRateCard('d1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('rateCardErrorMessage', () => {
  it.each([
    ['42501', 'rate card not found, or payroll.manage not held in its organization', /Only this organization's Administrator/],
    ['22023', 'the new card must start after its source (2026-07-06)', /^Check the details: The new card must start after its source \(2026-07-06\)\.$/],
    ['55000', 'card ICC-EA-2027-28 is already published', /^Card ICC-EA-2027-28 is already published\. Refresh/],
    ['23P01', 'card X overlaps another published card of this organization', /overlaps another published card/],
    ['23505', 'duplicate key value violates unique constraint', /already exists in this organization/],
  ])('%s reads in plain words', (code, message, expected) => {
    expect(rateCardErrorMessage({ code, message })).toMatch(expected);
  });

  it('anything else keeps the server\'s message', () => {
    expect(rateCardErrorMessage({ code: 'XX000', message: 'boom' })).toBe('The rate card could not be saved: Boom');
    expect(rateCardErrorMessage(undefined)).toBe('The rate card could not be saved. Try again.');
  });
});
