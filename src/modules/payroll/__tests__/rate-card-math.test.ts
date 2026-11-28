/**
 * The Versions tab's pure helpers: the ICC cl 25.1 multiplier, roll-forward
 * validation (mirrors roll_rate_card_forward's checks) and the draft-vs-source
 * comparison.
 */
import { describe, expect, it } from 'vitest';
import type { RateCard } from '../data/rateCards.api';
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';
import {
  LOADING_FIELDS, apprenticeRates, casualPaid, compareAllowances, compareLoadings, compareRates, formatLoading,
  inputToLoading, loadingToInput, percentToMultiplier, validateNewCard, type NewCardForm, iccCl251Multiplier, latestPublished, sourceCardOf, validateRollForward,
  type RollForwardForm,
} from '../ui/rate-admin/rateCardMath';

const card = (o: Partial<RateCard>): RateCard => ({
  id: 'id', organizationId: 'org-1', code: 'CODE', name: 'Name', currency: 'AUD', ruleSet: 'icc_sydney_ea',
  validFrom: '2025-01-01', validTo: null, status: 'published', derivation: null, publishedAt: null,
  notes: null, awardFloorCheckedAt: null, rates: [], allowances: [], loadings: null, trainee: null, ...o,
});

const C2025 = card({ id: 'a', code: 'ICC-EA-2025', validFrom: '2025-01-01', validTo: '2026-07-05' });
const C2026 = card({
  id: 'b', code: 'ICC-EA-2026-27', validFrom: '2026-07-06',
  rates: [{ classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 30, paidHourlyRate: 37.5, isManualOverride: false, notes: null }],
  allowances: [{ code: 'meal', amount: 20, unit: 'per_occasion', notes: null }],
});
const DRAFT = card({
  id: 'd', code: 'ICC-EA-2027-28', validFrom: '2027-07-05', status: 'draft', derivation: 'ICC-EA-2026-27 × 1.042',
  rates: [
    { classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 31.26, paidHourlyRate: 39.08, isManualOverride: false, notes: null },
    { classification: 'LEVEL_3', employmentBasis: 'casual', ordinaryHourlyRate: 32, paidHourlyRate: 40, isManualOverride: false, notes: null },
  ],
  allowances: [{ code: 'meal', amount: 20.84, unit: 'per_occasion', notes: null }],
});
const CARDS = [C2025, C2026, DRAFT];

describe('iccCl251Multiplier (ICC Sydney EA cl 25.1: 1 + (CPI + 0.5) / 100)', () => {
  it.each([
    [3.7, 1.042],
    [0, 1.005],
    [2.25, 1.0275],
    [-0.5, 1],
  ])('CPI %s%% → %s', (cpi, expected) => {
    expect(iccCl251Multiplier(cpi)).toBe(expected);
  });
});

describe('which card', () => {
  it('the default source is the latest published card, never a draft', () => {
    expect(latestPublished(CARDS)?.code).toBe('ICC-EA-2026-27');
    expect(latestPublished([DRAFT])).toBeNull();
  });

  it('a draft is compared with the card its derivation names', () => {
    expect(sourceCardOf(DRAFT, CARDS)?.code).toBe('ICC-EA-2026-27');
    expect(sourceCardOf({ ...DRAFT, derivation: 'ICC-EA-2025 × 1.1' }, CARDS)?.code).toBe('ICC-EA-2025');
  });

  it('without a derivation, with the published card before it', () => {
    expect(sourceCardOf({ ...DRAFT, derivation: null }, CARDS)?.code).toBe('ICC-EA-2026-27');
    expect(sourceCardOf({ ...DRAFT, derivation: null, validFrom: '2026-01-01' }, CARDS)?.code).toBe('ICC-EA-2025');
  });
});

describe('validateRollForward', () => {
  const ok: RollForwardForm = {
    sourceCardId: 'b', code: 'ICC-EA-2028-29', name: 'ICC 2028–29', validFrom: '2028-07-03', multiplier: '1.042',
  };

  it('a complete form passes', () => {
    expect(validateRollForward(ok, CARDS)).toEqual({});
  });

  it('flags every missing field', () => {
    const errors = validateRollForward({ sourceCardId: '', code: ' ', name: '', validFrom: '', multiplier: '' }, CARDS);
    expect(Object.keys(errors).sort()).toEqual(['code', 'multiplier', 'name', 'sourceCardId', 'validFrom']);
  });

  it('refuses a code already on a card of the organization, ignoring case', () => {
    expect(validateRollForward({ ...ok, code: 'icc-ea-2027-28' }, CARDS).code).toMatch(/already exists/);
  });

  it('the new card must start after its source (as the API requires)', () => {
    expect(validateRollForward({ ...ok, validFrom: '2026-07-06' }, CARDS).validFrom).toMatch(/after the source card starts \(2026-07-06\)/);
    expect(validateRollForward({ ...ok, validFrom: '2026-07-07' }, CARDS).validFrom).toBeUndefined();
  });

  it.each(['0', '-1', '2.01', 'abc'])('multiplier %s is refused', (m) => {
    expect(validateRollForward({ ...ok, multiplier: m }, CARDS).multiplier).toBeDefined();
  });

  it.each(['2', '0.95', '1'])('multiplier %s is accepted (0, 2]', (m) => {
    expect(validateRollForward({ ...ok, multiplier: m }, CARDS).multiplier).toBeUndefined();
  });
});

describe('draft vs source', () => {
  it('each rate line: old → new and % change; a line the source lacks is new', () => {
    expect(compareRates(DRAFT, C2026)).toEqual([
      { key: 'LEVEL_2|casual', classification: 'LEVEL_2', basis: 'casual', oldValue: 37.5, newValue: 39.08, changePct: 4.21 },
      { key: 'LEVEL_3|casual', classification: 'LEVEL_3', basis: 'casual', oldValue: null, newValue: 40, changePct: null },
    ]);
  });

  it('each allowance likewise', () => {
    expect(compareAllowances(DRAFT, C2026)).toEqual([
      { key: 'meal', code: 'meal', unit: 'per_occasion', oldValue: 20, newValue: 20.84, changePct: 4.2 },
    ]);
  });

  it('no source: every line is new', () => {
    expect(compareRates(DRAFT, null).every((l) => l.oldValue === null && l.changePct === null)).toBe(true);
  });
});

describe('compareLoadings (pay_rate_card_loadings, draft vs source)', () => {
  const ICC = { ...ICC_SYDNEY_EA_LOADINGS };
  const src = card({ id: 's', loadings: ICC });

  it('lists only the loadings the draft changed, labelled with their clause', () => {
    const draft = card({ id: 'd', status: 'draft', loadings: { ...ICC, saturdayLoading: 0.3, minEngagementSundayMinutes: 300 } });
    expect(compareLoadings(draft, src)).toEqual([
      { key: 'saturdayLoading', label: 'Saturday (cl 41)', unit: 'percent', oldValue: 0.25, newValue: 0.3 },
      { key: 'minEngagementSundayMinutes', label: 'Minimum engagement, Sunday (cl 12)', unit: 'minutes', oldValue: 240, newValue: 300 },
    ]);
  });

  it('a roll-forward keeps loadings unchanged, so there is nothing to list', () => {
    expect(compareLoadings(card({ id: 'd', status: 'draft', loadings: { ...ICC } }), src)).toEqual([]);
  });

  it('against a source without loadings, every value is new', () => {
    const rows = compareLoadings(card({ id: 'd', loadings: ICC }), card({ id: 's', loadings: null }));
    expect(rows).toHaveLength(LOADING_FIELDS.length);
    expect(rows.every((r) => r.oldValue === null)).toBe(true);
    expect(compareLoadings(card({ id: 'd', loadings: ICC }), null)).toHaveLength(LOADING_FIELDS.length);
  });

  it('a draft without loadings has nothing to compare', () => {
    expect(compareLoadings(card({ id: 'd', loadings: null }), src)).toEqual([]);
  });

  it('covers every loading the pay engine reads', () => {
    expect(LOADING_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(ICC_SYDNEY_EA_LOADINGS).sort());
  });

  it.each([
    ['percent', 0.175, '17.5%'],
    ['percent', 1.5, '150%'],
    ['multiplier', 1.5, '×1.5'],
    ['hours', 12, '12 h'],
    ['minutes', 180, '180 min'],
    ['dollars', 90, '$90.00'],
  ] as const)('formats %s %s as %s', (unit, value, expected) => {
    expect(formatLoading(unit, value)).toBe(expected);
  });
});

describe('authoring helpers', () => {
  it('casual paid = ordinary × (1 + casual loading), to cents (cl 12.5(b))', () => {
    expect(casualPaid(26.96, 0.25)).toBe(33.7);
    expect(casualPaid(34.1, 0.25)).toBe(42.63);
  });

  it.each([['5', 1.05], ['-2.5', 0.975], ['0', 1], ['', null], ['abc', null], ['-100', null], ['150', null]] as const)(
    'percentage %s → multiplier %s', (input, expected) => expect(percentToMultiplier(input)).toBe(expected));

  it('percent loadings are edited as percent; others as they are', () => {
    expect(loadingToInput('percent', 0.175)).toBe('17.5');
    expect(inputToLoading('percent', '17.5')).toBe(0.175);
    expect(inputToLoading('minutes', '240')).toBe(240);
    expect(inputToLoading('hours', '-1')).toBeNull();
    expect(inputToLoading('dollars', '')).toBeNull();
  });

  const form = (o: Partial<NewCardForm>): NewCardForm => ({
    mode: 'blank', sourceCardId: '', code: 'BCEC-1', name: 'BCEC', validFrom: '2026-07-01', notes: '',
    rates: true, allowances: true, trainee: true, multiplier: '1', ...o,
  });
  it('a new card needs a fresh code, a name and a date; a copy also a source and a multiplier in (0, 2]', () => {
    expect(validateNewCard(form({}), CARDS)).toEqual({});
    expect(validateNewCard(form({ code: 'icc-ea-2025', name: ' ', validFrom: 'x' }), CARDS)).toMatchObject({
      code: 'A card with this code already exists.', name: 'Enter a name.', validFrom: 'Enter the date the rates apply from.',
    });
    expect(Object.keys(validateNewCard(form({ mode: 'copy', sourceCardId: 'nope', multiplier: '3' }), CARDS)).sort())
      .toEqual(['multiplier', 'sourceCardId']);
  });

  it('Schedule 4 apprentice rates come from the card\'s own Level 4 and Level 1', () => {
    const c = card({ rates: [
      { classification: 'LEVEL_4', employmentBasis: 'permanent', ordinaryHourlyRate: 30, paidHourlyRate: 30, isManualOverride: false, notes: null },
      { classification: 'LEVEL_1', employmentBasis: 'permanent', ordinaryHourlyRate: 26, paidHourlyRate: 26, isManualOverride: false, notes: null },
    ] });
    const rows = apprenticeRates(c);
    expect(rows[0]).toEqual({ label: 'Junior, year 1 (50% of Level 4)', hourly: 15 });
    expect(rows.find((r) => r.label.startsWith('Adult, year 1'))?.hourly).toBe(24);   // 80% of L4
    expect(rows.find((r) => r.label.startsWith('Adult, year 2'))?.hourly).toBe(26);   // Level 1 beats 60% of L4
    expect(rows.find((r) => r.label.startsWith('Adult, year 4'))?.hourly).toBe(28.5); // 95% of L4 beats Level 1
    expect(apprenticeRates(card({}))).toEqual([]);
  });
});
