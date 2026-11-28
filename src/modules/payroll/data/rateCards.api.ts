/**
 * Pay rate cards — the rate-card API for the rate-admin Versions tab
 * (migration *_rate_cards_per_period; docs/architecture/multi-organization.md
 * §11.1 R8/R9, R12).
 *
 * Lists the organization's cards — drafts included, which row-level security
 * returns only to payroll.manage holders (`can_read_rate_card`) — with their
 * rate, allowance and loadings lines, and calls the three RPCs:
 *   roll_rate_card_forward → a draft (every figure × multiplier, to cents)
 *   publish_rate_card      → closes the open-ended predecessor at valid_from − 1
 *   discard_rate_card      → drafts only
 * The database is the authority: every gate and rule lives in those functions.
 */

import { supabase } from '@/platform/supabase/client';
import {
  mapDbLoadingsRow, type RateCardLoadings,
} from '@/modules/rosters/domain/projections/utils/cost/loadings';

import { RATE_CARD_SELECT } from './rateCards.select';

export { RATE_CARD_SELECT };

export type RateCardStatus = 'draft' | 'published';

export interface RateCardRate {
  classification: string;
  employmentBasis: string;
  ordinaryHourlyRate: number;
  paidHourlyRate: number;
}

export interface RateCardAllowance {
  code: string;
  amount: number;
  unit: string;
}

export interface RateCard {
  id: string;
  code: string;
  name: string;
  validFrom: string;          // YYYY-MM-DD
  validTo: string | null;     // null = open-ended, until the next card
  status: RateCardStatus;
  derivation: string | null;  // e.g. 'ICC-EA-2026-27 × 1.042'
  publishedAt: string | null;
  rates: RateCardRate[];
  allowances: RateCardAllowance[];
  /** pay_rate_card_loadings (1:1). null: none yet — publish_rate_card refuses such a card. */
  loadings: RateCardLoadings | null;
}

export interface RollForwardInput {
  sourceCardId: string;
  code: string;
  name: string;
  validFrom: string;          // YYYY-MM-DD
  multiplier: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** One-to-one embeds arrive as an object; tolerate the array form older PostgREST returns. */
const toLoadings = (v: unknown): RateCardLoadings | null => {
  const row = Array.isArray(v) ? v[0] : v;
  return row ? mapDbLoadingsRow(row as Record<string, unknown>) : null;
};

const ymd = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

function toRateCard(row: any): RateCard {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    validFrom: ymd(row.valid_from) ?? '',
    validTo: ymd(row.valid_to),
    status: row.status === 'published' ? 'published' : 'draft',
    derivation: row.derivation ?? null,
    publishedAt: row.published_at ?? null,
    rates: ((row.eba_rate ?? []) as any[]).map((r) => ({
      classification: String(r.classification),
      employmentBasis: String(r.employment_basis),
      ordinaryHourlyRate: num(r.ordinary_hourly_rate),
      paidHourlyRate: num(r.paid_hourly_rate),
    })),
    allowances: ((row.eba_allowance ?? []) as any[]).map((a) => ({
      code: String(a.code),
      amount: num(a.amount),
      unit: String(a.unit),
    })),
    loadings: toLoadings(row.pay_rate_card_loadings),
  };
}

/**
 * The organization's cards, oldest period first. Throws on error so the screen
 * can say the read failed instead of showing an empty list.
 */
export async function listRateCards(organizationId: string | null): Promise<RateCard[]> {
  if (!organizationId) return [];
  const { data, error } = await (supabase as any)
    .from('pay_rate_cards')
    .select(RATE_CARD_SELECT)
    .eq('organization_id', organizationId)
    .order('valid_from', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(toRateCard);
}

/** Rolls `sourceCardId` forward into a new draft; returns the draft's id. */
export async function rollRateCardForward(input: RollForwardInput): Promise<string> {
  const { data, error } = await (supabase as any).rpc('roll_rate_card_forward', {
    p_source_card_id: input.sourceCardId,
    p_code: input.code.trim(),
    p_name: input.name.trim(),
    p_valid_from: input.validFrom,
    p_multiplier: input.multiplier,
  });
  if (error) throw error;
  return String(data);
}

export async function publishRateCard(cardId: string): Promise<void> {
  const { error } = await (supabase as any).rpc('publish_rate_card', { p_card_id: cardId });
  if (error) throw error;
}

export async function discardRateCard(cardId: string): Promise<void> {
  const { error } = await (supabase as any).rpc('discard_rate_card', { p_card_id: cardId });
  if (error) throw error;
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The server's refusal in plain words. The RPCs raise one SQLSTATE per kind of
 * refusal (and the card code's unique key raises 23505); their own messages
 * already name the detail, so they are kept where they help.
 */
export function rateCardErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  const detail = sentence(String(e.message ?? '').trim());
  switch (e.code) {
    case '42501':
      return 'Only this organization\'s Administrator can manage its rate cards, or the card no longer exists. Refresh and try again.';
    case '22023':
      return `Check the details: ${detail || 'a value was not accepted'}.`;
    case '55000':
      return `${detail || 'The card is not in a state that allows this'}. Refresh the list to see its current state.`;
    case '23P01':
      return 'This card\'s period overlaps another published card. Its start date must fall after every published card except the open-ended one it replaces.';
    case '23505':
      return 'A card with that code already exists in this organization. Choose another code.';
    default:
      return detail ? `The rate card could not be saved: ${detail}` : 'The rate card could not be saved. Try again.';
  }
}
