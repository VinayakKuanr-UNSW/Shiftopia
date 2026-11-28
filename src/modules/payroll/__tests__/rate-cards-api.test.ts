/**
 * rateCards.api — the rate-card API adapter. Network-free:
 * `@/platform/supabase/client` is mocked; each test sets what the query
 * builder and `rpc` resolve to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const builder: Record<string, any> = {};
  const result = { data: null as unknown, error: null as unknown };
  for (const m of ['select', 'eq', 'order', 'maybeSingle']) builder[m] = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { builder, result, from: vi.fn(() => builder), rpc: vi.fn() };
});

vi.mock('@/platform/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  ICC_SYDNEY_EA_LOADINGS, RATE_CARD_LOADINGS_SELECT,
} from '@/modules/rosters/domain/projections/utils/cost/loadings';
import {
  bulkAdjustRateCardRates, copyRateCard, createRateCard, deleteRateCardItems, estimateShiftCost,
  getOrganizationJurisdiction, toDbLoadingsPatch, updateRateCardLoadings, updateRateCardMeta, upsertRateCardRates,
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
      id: 'c1', organization_id: 'org-1', code: 'ICC-EA-2026-27', name: 'ICC 2026–27', currency: 'AUD', rule_set: 'icc_sydney_ea',
      valid_from: '2026-07-06', valid_to: null, status: 'published', derivation: null, published_at: '2026-11-28T00:00:00Z',
      notes: 'FWC approved', award_floor_checked_at: '2026-11-01T00:00:00Z',
      eba_rate: [{ classification: 'LEVEL_2', employment_basis: 'casual', ordinary_hourly_rate: '30.10', paid_hourly_rate: '37.63', is_manual_override: true, notes: 'Sch 2' }],
      eba_allowance: [{ code: 'meal', amount: '18.4', unit: 'per_occasion', notes: null }],
      eba_trainee_schedule: { label: 'ICC trainees', source: 'Sch 5', matrix: { adult: {} } },
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
      id: 'c1', organizationId: 'org-1', code: 'ICC-EA-2026-27', name: 'ICC 2026–27', currency: 'AUD', ruleSet: 'icc_sydney_ea',
      validFrom: '2026-07-06', validTo: null, status: 'published', derivation: null, publishedAt: '2026-11-28T00:00:00Z',
      notes: 'FWC approved', awardFloorCheckedAt: '2026-11-01T00:00:00Z',
      rates: [{ classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 30.1, paidHourlyRate: 37.63, isManualOverride: true, notes: 'Sch 2' }],
      allowances: [{ code: 'meal', amount: 18.4, unit: 'per_occasion', notes: null }],
      loadings: ICC_SYDNEY_EA_LOADINGS,
      trainee: { label: 'ICC trainees', source: 'Sch 5', matrix: { adult: {} } },
    });
    expect(cards[1]).toMatchObject({ status: 'draft', derivation: 'ICC-EA-2026-27 × 1.042', loadings: null, trainee: null });
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

describe('authoring RPCs', () => {
  beforeEach(() => h.rpc.mockResolvedValue({ data: 'id-1', error: null }));

  it('create sends the organization, trimmed names and the ICC rule set; returns the id', async () => {
    expect(await createRateCard({ organizationId: 'o', code: ' BCEC-1 ', name: ' BCEC ', validFrom: '2026-07-01', notes: '  ' })).toBe('id-1');
    expect(h.rpc).toHaveBeenCalledWith('create_rate_card', {
      p_org_id: 'o', p_code: 'BCEC-1', p_name: 'BCEC', p_valid_from: '2026-07-01',
      p_currency: 'AUD', p_rule_set: 'icc_sydney_ea', p_notes: null,
    });
  });

  it('copy defaults to everything at × 1 in the source organization', async () => {
    await copyRateCard({ sourceCardId: 's', code: 'C', name: 'N', validFrom: '2030-07-01' });
    expect(h.rpc).toHaveBeenCalledWith('copy_rate_card', {
      p_source_card_id: 's', p_target_org_id: null, p_code: 'C', p_name: 'N', p_valid_from: '2030-07-01',
      p_options: { rates: true, allowances: true, trainee: true, multiplier: 1 },
    });
  });

  it('meta sends only what changed, under the column names', async () => {
    await updateRateCardMeta('c', { validTo: null, awardFloorChecked: true, notes: 'FWC' });
    expect(h.rpc).toHaveBeenCalledWith('update_rate_card_meta', {
      p_card_id: 'c', p_patch: { valid_to: null, notes: 'FWC', award_floor_checked: true },
    });
  });

  it('a rate line without a paid rate leaves it to the database (cl 12.5(b) formula)', async () => {
    await upsertRateCardRates('c', [{ classification: 'LEVEL_1', employmentBasis: 'casual', ordinaryHourlyRate: 30 }]);
    expect(h.rpc).toHaveBeenCalledWith('upsert_rate_card_rates', {
      p_card_id: 'c', p_items: [{ classification: 'LEVEL_1', employment_basis: 'casual', ordinary_hourly_rate: 30 }],
    });
  });

  it('removal, bulk adjust and loadings use the RPCs\' names', async () => {
    await deleteRateCardItems('c', [{ classification: 'LEVEL_1', employmentBasis: 'casual' }], ['meal']);
    await bulkAdjustRateCardRates('c', null, 1.05);
    await updateRateCardLoadings('c', { saturdayLoading: 0.3, minEngagementSundayMinutes: 300, swsMinWeekly: 95 });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'delete_rate_card_items', {
      p_card_id: 'c', p_rates: [{ classification: 'LEVEL_1', employment_basis: 'casual' }], p_allowance_codes: ['meal'],
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'bulk_adjust_rate_card_rates', { p_card_id: 'c', p_classifications: null, p_multiplier: 1.05 });
    expect(h.rpc).toHaveBeenNthCalledWith(3, 'update_rate_card_loadings', {
      p_card_id: 'c', p_loadings: { saturday_loading: 0.3, min_engagement_sunday_minutes: 300, sws_min_weekly: 95 },
    });
  });

  it('every loading maps to a real pay_rate_card_loadings column', () => {
    const cols = RATE_CARD_LOADINGS_SELECT.split(', ').sort();
    expect(Object.keys(toDbLoadingsPatch(ICC_SYDNEY_EA_LOADINGS)).sort()).toEqual(cols);
  });

  it('the sandbox prices through fn_eba_estimate_shift_cost with the card and jurisdiction', async () => {
    h.rpc.mockResolvedValue({ data: '291.04', error: null });
    expect(await estimateShiftCost('card', 'AU-NSW', { shiftDate: '2027-07-10', startTime: '07:00', minutes: 420, baseRate: 34.64, employmentType: 'Casual' }))
      .toBe(291.04);
    expect(h.rpc).toHaveBeenCalledWith('fn_eba_estimate_shift_cost', {
      p_shift_date: '2027-07-10', p_start_time: '07:00', p_net_minutes: 420, p_scheduled_minutes: 420,
      p_base_rate: 34.64, p_employment_type: 'Casual', p_rate_card_id: 'card', p_jurisdiction: 'AU-NSW',
    });
  });

  it('jurisdiction comes from the organization', async () => {
    h.result.data = { jurisdiction: 'AU-QLD-BNE' };
    expect(await getOrganizationJurisdiction('o')).toBe('AU-QLD-BNE');
    expect(h.from).toHaveBeenCalledWith('organizations');
  });
});
