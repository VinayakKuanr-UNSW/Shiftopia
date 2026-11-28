/**
 * rate-card-resolver — published cards → what the engine prices from.
 *
 *  1. Parity: ICC Sydney's two seeded cards (supabase/seeds/reference.sql)
 *     produce EXACTLY the embedded RATE_SCHEDULE, so switching Gross Pay onto
 *     the cards changes no ICC figure by a cent.
 *  2. Periods are strict [valid_from, valid_to]; no card ⇒ unpriced, never a
 *     fallback to ICC (multi-organization.md P4/R4).
 *  3. The engines price from the card when given one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ICC_SYDNEY_EA_LOADINGS, mapDbLoadingsRow } from '../../projections/utils/cost/loadings';
import { RATE_SCHEDULE } from '../../projections/utils/cost/rate-schedule';
import {
  rateSetFromCard, resolveCardOn, resolvePricing, toPricedCard, type PricedCard, type PublishedCardInput,
} from '../../projections/utils/cost/rate-card-resolver';
import { estimateDetailedShiftCost as estimateStandard } from '../../projections/utils/cost/standard';
import { estimateDetailedShiftCost as estimateSecurity } from '../../projections/utils/cost/security';
import { buildAwardContext } from '../../projections/utils/cost/award-context';

const REPO_ROOT = resolve(__dirname, '../../../../../..');
const SEED = readFileSync(resolve(REPO_ROOT, 'supabase/seeds/reference.sql'), 'utf8');

function seedRows(table: string): Array<Record<string, any>> {
  const re = new RegExp('^INSERT INTO public\\.' + table + ' .*?jsonb_populate_record\\(NULL::public\\.' + table + ", '(.*)'\\) ON CONFLICT DO NOTHING;$", 'gm');
  const rows: Array<Record<string, any>> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SEED)) !== null) rows.push(JSON.parse(m[1].replace(/''/g, "'")));
  return rows;
}

/** The seeded cards, as the data layer would read them. */
function seededCards(): PublishedCardInput[] {
  const rates = seedRows('eba_rate');
  const allowances = seedRows('eba_allowance');
  const loadings = seedRows('pay_rate_card_loadings');
  return seedRows('pay_rate_cards').map((c) => ({
    code: c.code,
    validFrom: c.valid_from,
    validTo: c.valid_to,
    rates: rates.filter((r) => r.rate_card_id === c.id).map((r) => ({
      classification: r.classification, employmentBasis: r.employment_basis,
      ordinaryHourlyRate: Number(r.ordinary_hourly_rate), paidHourlyRate: Number(r.paid_hourly_rate),
    })),
    allowances: allowances.filter((a) => a.rate_card_id === c.id).map((a) => ({ code: a.code, amount: Number(a.amount) })),
    loadings: mapDbLoadingsRow(loadings.find((l) => l.rate_card_id === c.id)!),
    trainee: null,
  })).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

const ICC_CARDS: PricedCard[] = seededCards().map((c) => toPricedCard(c)!);

describe('ICC Sydney\'s seeded cards = the embedded schedule', () => {
  it('two cards, ICC-EA-2025 then ICC-EA-2026-27', () => {
    expect(ICC_CARDS.map((c) => [c.code, c.validFrom, c.validTo])).toEqual([
      ['ICC-EA-2025', '2025-01-01', '2026-07-05'],
      ['ICC-EA-2026-27', '2026-07-06', null],
    ]);
  });

  it.each([0, 1])('card %i: every wage, allowance, security rate and the default rate match RATE_SCHEDULE', (i) => {
    const fromCard = ICC_CARDS[i].rateSet;
    const embedded = RATE_SCHEDULE[i];
    expect(fromCard.wageRates).toEqual(embedded.wageRates);
    expect(fromCard.allowances).toEqual(embedded.allowances);
    expect(fromCard.security).toEqual(embedded.security);
    expect(fromCard.defaultRate).toBe(embedded.defaultRate);
    expect(ICC_CARDS[i].loadings).toEqual(ICC_SYDNEY_EA_LOADINGS);
  });
});

describe('periods are strict; no card means unpriced', () => {
  it.each([
    ['2026-07-05', 'ICC-EA-2025'],
    ['2026-07-06', 'ICC-EA-2026-27'],
    ['2031-01-01', 'ICC-EA-2026-27'],
    ['2025-01-01', 'ICC-EA-2025'],
    ['2024-12-31', null],
  ])('%s → %s', (date, code) => {
    expect(resolveCardOn(ICC_CARDS, date)?.code ?? null).toBe(code);
  });

  it('an organization with no cards prices nothing — never ICC\'s rates', () => {
    expect(resolveCardOn([], '2026-08-01')).toBeNull();
    expect(resolvePricing('2026-08-01', [])).toBeNull();
  });

  it('without a schedule the embedded path is unchanged', () => {
    const p = resolvePricing('2026-08-01', undefined)!;
    expect(p.rateSet).toBe(RATE_SCHEDULE[1]);
    expect(p.cardCode).toBeNull();
  });

  it('explicit loadings still win over the card\'s', () => {
    const custom = { ...ICC_SYDNEY_EA_LOADINGS, saturdayLoading: 0.4 };
    expect(resolvePricing('2026-08-01', ICC_CARDS, custom)!.loadings).toBe(custom);
    expect(resolvePricing('2026-08-01', ICC_CARDS)!.loadings).toEqual(ICC_SYDNEY_EA_LOADINGS);
  });

  it('a card without a classification simply lacks it', () => {
    const set = rateSetFromCard({ code: 'X', validFrom: '2026-01-01', validTo: null, rates: [], allowances: [], loadings: null, trainee: null });
    expect(set.wageRates).toEqual({});
    expect(Number.isNaN(set.defaultRate)).toBe(true);
    expect(toPricedCard({ code: 'X', validFrom: '2026-01-01', validTo: null, rates: [], allowances: [], loadings: null, trainee: null })).toBeNull();
  });
});

/** A non-ICC card: $40 Level 2 casual, 30% Saturday, $20 meal. */
const CUSTOM: PricedCard = toPricedCard({
  code: 'BCEC-EA', validFrom: '2026-01-01', validTo: null,
  rates: [
    { classification: 'LEVEL_1', employmentBasis: 'permanent', ordinaryHourlyRate: 30, paidHourlyRate: 30 },
    { classification: 'LEVEL_1', employmentBasis: 'casual', ordinaryHourlyRate: 30, paidHourlyRate: 37.5 },
    { classification: 'LEVEL_2', employmentBasis: 'permanent', ordinaryHourlyRate: 32, paidHourlyRate: 32 },
    { classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 32, paidHourlyRate: 40 },
  ],
  allowances: [{ code: 'meal', amount: 20 }],
  loadings: { ...ICC_SYDNEY_EA_LOADINGS, saturdayLoading: 0.3 },
  trainee: null,
})!;

const SAT_SHIFT = {
  shift_date: '2027-07-10', start_time: '07:00', end_time: '14:00',
  netMinutes: 420, scheduled_length_minutes: 420, rate: null as unknown as number,
  classificationLevel: 'LEVEL_2', employmentType: 'Casual' as const, is_overnight: false, is_cancelled: false,
};

describe('the engines price from the card', () => {
  it('standard: a Saturday casual at the card\'s $40 and 30% (7h × $32 × 1.55)', () => {
    const r = estimateStandard({ ...SAT_SHIFT, rateCards: [CUSTOM] });
    expect(r.unpriced).toBeUndefined();
    expect(r.totalCost).toBe(347.2);
  });

  it('standard: an organization without a card covering the date is unpriced, not priced at ICC rates', () => {
    const r = estimateStandard({ ...SAT_SHIFT, rateCards: [] });
    expect(r.unpriced).toBe(true);
    expect(r.totalCost).toBe(0);
  });

  it('standard: the schedule can come from the AwardContext instead', () => {
    const ctx = { ...buildAwardContext(['2027-07-10']), rateCards: [CUSTOM] };
    expect(estimateStandard(SAT_SHIFT, ctx).totalCost).toBe(347.2);
  });

  it('standard: with ICC\'s cards the result is exactly the embedded engine\'s', () => {
    const embedded = estimateStandard(SAT_SHIFT);
    expect(estimateStandard({ ...SAT_SHIFT, rateCards: ICC_CARDS })).toEqual(embedded);
  });

  it('security: unpriced without a card covering the date', () => {
    const r = estimateSecurity({ ...SAT_SHIFT, classificationLevel: 'SECURITY_LEVEL_4', isSecurityRole: true, rateCards: [] } as any);
    expect(r.unpriced).toBe(true);
    expect(r.totalCost).toBe(0);
  });
});
