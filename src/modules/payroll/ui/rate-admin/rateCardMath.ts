/**
 * Pure helpers behind the Versions tab: the ICC agreement's indexation
 * formula, roll-forward validation, and the draft-vs-source comparison.
 * The database re-checks everything (roll_rate_card_forward); validating here
 * only saves a round trip and says what is wrong next to the field.
 */

import type { RateCard } from '../../data/rateCards.api';
import type { RateCardLoadings } from '@/modules/rosters/domain/projections/utils/cost/loadings';

/** The bounds roll_rate_card_forward enforces: (0, 2]. */
export const MULTIPLIER_MAX = 2;

/**
 * ICC Sydney Enterprise Agreement cl 25.1: rates rise by CPI plus half a
 * percentage point, so the multiplier is 1 + (CPI + 0.5) / 100. This is that
 * agreement's rule, not the API's — another agreement indexes differently.
 * Rounded to 6 places so float noise (1.0420000000000003) never reaches the
 * card's derivation.
 */
export function iccCl251Multiplier(cpiPercent: number): number {
  return Math.round((1 + (cpiPercent + 0.5) / 100) * 1e6) / 1e6;
}

/** The latest published card: the default source to roll forward. */
export function latestPublished(cards: readonly RateCard[]): RateCard | null {
  return cards
    .filter((c) => c.status === 'published')
    .reduce<RateCard | null>((best, c) => (!best || c.validFrom > best.validFrom ? c : best), null);
}

/**
 * The card a draft was rolled from. The API records it in `derivation`
 * ('<source code> × <multiplier>'); a draft without one is compared with the
 * published card before it.
 */
export function sourceCardOf(draft: RateCard, cards: readonly RateCard[]): RateCard | null {
  const code = draft.derivation?.split(' × ')[0];
  const named = code ? cards.find((c) => c.code === code && c.id !== draft.id) : undefined;
  if (named) return named;
  return latestPublished(cards.filter((c) => c.validFrom < draft.validFrom));
}

export interface RollForwardForm {
  sourceCardId: string;
  code: string;
  name: string;
  validFrom: string;
  multiplier: string;
}

export type RollForwardErrors = Partial<Record<keyof RollForwardForm, string>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Field-level problems with a roll-forward; empty when it may be sent. */
export function validateRollForward(form: RollForwardForm, cards: readonly RateCard[]): RollForwardErrors {
  const errors: RollForwardErrors = {};
  const source = cards.find((c) => c.id === form.sourceCardId);
  if (!source) errors.sourceCardId = 'Choose the card to roll forward.';

  const code = form.code.trim();
  if (!code) errors.code = 'Enter a code, e.g. ICC-EA-2027-28.';
  else if (cards.some((c) => c.code.toLowerCase() === code.toLowerCase())) {
    errors.code = 'A card with this code already exists.';
  }

  if (!form.name.trim()) errors.name = 'Enter a name.';

  if (!ISO_DATE.test(form.validFrom) || Number.isNaN(Date.parse(form.validFrom))) {
    errors.validFrom = 'Enter the date the new rates apply from.';
  } else if (source && form.validFrom <= source.validFrom) {
    errors.validFrom = `Must be after the source card starts (${source.validFrom}).`;
  }

  const m = Number(form.multiplier);
  if (form.multiplier.trim() === '' || !Number.isFinite(m)) {
    errors.multiplier = 'Enter a multiplier, e.g. 1.042 for a 4.2% rise.';
  } else if (m <= 0 || m > MULTIPLIER_MAX) {
    errors.multiplier = `Must be greater than 0 and at most ${MULTIPLIER_MAX}.`;
  }
  return errors;
}

export interface LineChange {
  key: string;
  classification?: string;
  basis?: string;
  code?: string;
  unit?: string;
  oldValue: number | null;
  newValue: number;
  /** Percent change from the source, to 2 places; null when the source has no such line. */
  changePct: number | null;
}

const pct = (from: number | null, to: number): number | null =>
  from == null || from === 0 ? null : Math.round(((to - from) / from) * 10000) / 100;

/** Each of the draft's rate lines (paid hourly rate) against the same line on the source. */
export function compareRates(draft: RateCard, source: RateCard | null): LineChange[] {
  const old = new Map((source?.rates ?? []).map((r) => [`${r.classification}|${r.employmentBasis}`, r.paidHourlyRate]));
  return draft.rates.map((r) => {
    const key = `${r.classification}|${r.employmentBasis}`;
    const oldValue = old.get(key) ?? null;
    return {
      key, classification: r.classification, basis: r.employmentBasis,
      oldValue, newValue: r.paidHourlyRate, changePct: pct(oldValue, r.paidHourlyRate),
    };
  });
}

/** Each of the draft's allowances against the same allowance on the source. */
export function compareAllowances(draft: RateCard, source: RateCard | null): LineChange[] {
  const old = new Map((source?.allowances ?? []).map((a) => [a.code, a.amount]));
  return draft.allowances.map((a) => {
    const oldValue = old.get(a.code) ?? null;
    return { key: a.code, code: a.code, unit: a.unit, oldValue, newValue: a.amount, changePct: pct(oldValue, a.amount) };
  });
}

export type LoadingUnit = 'percent' | 'multiplier' | 'hours' | 'minutes' | 'dollars';

/** Every pay_rate_card_loadings value, in the order the review lists them, with its clause. */
export const LOADING_FIELDS: ReadonlyArray<{ key: keyof RateCardLoadings; label: string; unit: LoadingUnit }> = [
  { key: 'casualLoading', label: 'Casual loading (cl 12.5(b))', unit: 'percent' },
  { key: 'saturdayLoading', label: 'Saturday (cl 41)', unit: 'percent' },
  { key: 'sundayLoading', label: 'Sunday (cl 41)', unit: 'percent' },
  { key: 'publicHolidayLoading', label: 'Public holiday (cl 41)', unit: 'percent' },
  { key: 'nightLoadingMonThu', label: 'Night, concluding Mon–Thu (cl 43)', unit: 'percent' },
  { key: 'nightLoadingFri', label: 'Night, concluding Fri (cl 43)', unit: 'percent' },
  { key: 'nightLoadingSatSun', label: 'Night, concluding Sat–Sun (cl 43)', unit: 'percent' },
  { key: 'annualLeaveLoading', label: 'Annual leave loading (cl 44.7)', unit: 'percent' },
  { key: 'overtimeFirstHours', label: 'Overtime, first-tier length (cl 42.2)', unit: 'hours' },
  { key: 'overtimeFirstMultiplier', label: 'Overtime, first tier (cl 42.2)', unit: 'multiplier' },
  { key: 'overtimeAfterMultiplier', label: 'Overtime, after the first tier (cl 42.2)', unit: 'multiplier' },
  { key: 'overtimePublicHolidayMultiplier', label: 'Overtime on a public holiday, at least (cl 42)', unit: 'multiplier' },
  { key: 'ordinaryDailyCapHours', label: 'Ordinary hours a day before overtime (cl 42)', unit: 'hours' },
  { key: 'securityOrdinaryCapHours', label: 'Security ordinary hours a day (Sch 2 §2)', unit: 'hours' },
  { key: 'minEngagementMinutes', label: 'Minimum engagement (cl 12)', unit: 'minutes' },
  { key: 'minEngagementSundayMinutes', label: 'Minimum engagement, Sunday (cl 12)', unit: 'minutes' },
  { key: 'minEngagementPublicHolidayMinutes', label: 'Minimum engagement, public holiday (cl 56.2)', unit: 'minutes' },
  { key: 'minEngagementTrainingMinutes', label: 'Minimum engagement, training', unit: 'minutes' },
  { key: 'higherDutiesMinHours', label: 'Higher duties, minimum paid hours (cl 29.1(a))', unit: 'hours' },
  { key: 'mealAllowanceTriggerHours', label: 'Meal allowance, hours past rostered finish (cl 28.1)', unit: 'hours' },
  { key: 'swsMinWeekly', label: 'Supported wage, minimum weekly payment (Sch 6 §1.4.2)', unit: 'dollars' },
];

/** 0.25 → "25%", 1.5 → "×1.5", 12 → "12 h", 180 → "180 min", 90 → "$90.00". */
export function formatLoading(unit: LoadingUnit, value: number): string {
  switch (unit) {
    case 'percent': return `${Number((value * 100).toFixed(4))}%`;
    case 'multiplier': return `×${value}`;
    case 'hours': return `${value} h`;
    case 'minutes': return `${value} min`;
    case 'dollars': return `$${value.toFixed(2)}`;
  }
}

export interface LoadingChange {
  key: keyof RateCardLoadings;
  label: string;
  unit: LoadingUnit;
  /** null when the source has no loadings. */
  oldValue: number | null;
  newValue: number;
}

/**
 * The draft's loadings that differ from the source's. A roll-forward copies
 * loadings unchanged, so this lists only what update_rate_card_loadings edited.
 */
export function compareLoadings(draft: RateCard, source: RateCard | null): LoadingChange[] {
  const next = draft.loadings;
  if (!next) return [];
  const prev = source?.loadings ?? null;
  return LOADING_FIELDS
    .filter((f) => !prev || prev[f.key] !== next[f.key])
    .map((f) => ({ ...f, oldValue: prev ? prev[f.key] : null, newValue: next[f.key] }));
}
