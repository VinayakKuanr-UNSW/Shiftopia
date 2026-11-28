/**
 * Rate-card resolver — turns an organization's PUBLISHED pay rate cards into
 * what the cost engine prices from, per shift date. Worker-safe: no DOM, no
 * React, no Supabase (the payroll data layer fetches the cards and passes them
 * in as `CostCalculatorOptions.rateCards` / `AwardContext.rateCards`).
 *
 * The rule (multi-organization.md P4/R4, matching SQL internal.shift_pay_terms):
 * when a schedule is supplied, a shift is priced from the card whose period
 * [valid_from, valid_to] covers its date — and if none does it is UNPRICED.
 * It never falls back to another organization's rates or to the embedded ICC
 * schedule. Without a schedule (callers not yet wired) the engine keeps its
 * embedded `RATE_SCHEDULE` path unchanged.
 */

import { ICC_SYDNEY_EA_LOADINGS, type RateCardLoadings } from './loadings';
import { resolveRateSet, type RateSet, type WageRateTable } from './rate-schedule';
import type { TraineeRateSet } from './trainee_matrix';

/** One published card, ready to price from. */
export interface PricedCard {
  code: string;
  validFrom: string;            // YYYY-MM-DD, inclusive
  validTo: string | null;       // inclusive; null = open-ended
  rateSet: RateSet;
  loadings: RateCardLoadings;
  trainee: TraineeRateSet | null;
}

export type RateCardSchedule = readonly PricedCard[];

/** A published card as the data layer reads it (pay_rate_cards + its lines). */
export interface PublishedCardInput {
  code: string;
  validFrom: string;
  validTo: string | null;
  rates: ReadonlyArray<{ classification: string; employmentBasis: string; ordinaryHourlyRate: number; paidHourlyRate: number }>;
  allowances: ReadonlyArray<{ code: string; amount: number }>;
  loadings: RateCardLoadings | null;
  trainee: { label: string | null; source: string | null; matrix: Record<string, unknown> } | null;
}

const SECURITY_LEVELS = ['3', '4', '5', '6'] as const;

/**
 * The card's lines in the engine's RateSet shape — the same shape the embedded
 * RATE_SCHEDULE has, so a seeded ICC card produces exactly that schedule's
 * figures (rate-card-resolver.test.ts). A classification the card lacks is
 * simply absent: the engine then treats the shift as it treats any unknown level.
 */
export function rateSetFromCard(card: PublishedCardInput): RateSet {
  const paid = (cls: string, basis: string) =>
    card.rates.find((r) => r.classification === cls && r.employmentBasis === basis);
  const wageRates: Record<string, { permanent: number; casual: number }> = {};
  for (const r of card.rates) {
    if (r.classification.startsWith('SECURITY_') || wageRates[r.classification]) continue;
    const perm = paid(r.classification, 'permanent');
    const cas = paid(r.classification, 'casual');
    if (perm && cas) wageRates[r.classification] = { permanent: perm.paidHourlyRate, casual: cas.paidHourlyRate };
  }
  const allowance = (code: string) => card.allowances.find((a) => a.code === code)?.amount ?? 0;
  const annualisedHourly = {} as RateSet['security']['annualisedHourly'];
  const ordinaryFromAnnualised: Record<number, number> = {};
  for (const n of SECURITY_LEVELS) {
    const line = paid('SECURITY_LEVEL_' + n, 'annualised');
    if (!line) continue;
    annualisedHourly[('level' + n) as keyof typeof annualisedHourly] = line.paidHourlyRate;
    ordinaryFromAnnualised[line.paidHourlyRate] = line.ordinaryHourlyRate;
  }
  return {
    effectiveFrom: card.validFrom,
    label: card.code,
    source: 'pay_rate_cards ' + card.code,
    // Same role as the embedded schedule's default: Level 1 casual.
    defaultRate: wageRates.LEVEL_1?.casual ?? Number.NaN,
    wageRates: wageRates as unknown as WageRateTable,
    allowances: {
      meal: allowance('meal'),
      firstAidPerHour: allowance('first_aid_per_hour'),
      proteinSpill: allowance('protein_spill'),
      splitShift: allowance('split_shift'),
    },
    security: { annualisedHourly, ordinaryFromAnnualised },
  };
}

/** A published card → a priced card. A card without loadings cannot be published, so none is expected here. */
export function toPricedCard(card: PublishedCardInput): PricedCard | null {
  if (!card.loadings) return null;
  return {
    code: card.code,
    validFrom: card.validFrom,
    validTo: card.validTo,
    rateSet: rateSetFromCard(card),
    loadings: card.loadings,
    trainee: card.trainee
      ? { effectiveFrom: card.validFrom, label: card.trainee.label ?? card.code, source: card.trainee.source ?? '', ...card.trainee.matrix } as TraineeRateSet
      : null,
  };
}

const ymd = (d?: string | null) => (d ? String(d).slice(0, 10) : '');

/** The card in force on `date`: valid_from ≤ date ≤ valid_to (open-ended when null). null = none. */
export function resolveCardOn(schedule: RateCardSchedule, date?: string | null): PricedCard | null {
  const d = ymd(date);
  if (!d) return null;
  let best: PricedCard | null = null;
  for (const c of schedule) {
    if (c.validFrom <= d && (c.validTo === null || d <= c.validTo) && (!best || c.validFrom > best.validFrom)) best = c;
  }
  return best;
}

export interface Pricing {
  rateSet: RateSet;
  loadings: RateCardLoadings;
  /** The card's Schedule 5 set; null = the engine's embedded trainee schedule. */
  trainee: TraineeRateSet | null;
  /** The card priced from; null on the embedded path. */
  cardCode: string | null;
}

/**
 * What a shift on `date` is priced from. With `rateCards`, the covering card
 * (explicit `loadings` still win, as before) — or null: UNPRICED. Without, the
 * embedded schedule and `fallbackLoadings` (AwardContext) or ICC's.
 */
export function resolvePricing(
  date: string | null | undefined,
  rateCards: RateCardSchedule | undefined,
  loadings?: RateCardLoadings,
  fallbackLoadings?: RateCardLoadings,
): Pricing | null {
  if (!rateCards) {
    return { rateSet: resolveRateSet(date), loadings: loadings ?? fallbackLoadings ?? ICC_SYDNEY_EA_LOADINGS, trainee: null, cardCode: null };
  }
  const card = resolveCardOn(rateCards, date);
  if (!card) return null;
  return { rateSet: card.rateSet, loadings: loadings ?? card.loadings, trainee: card.trainee, cardCode: card.code };
}
