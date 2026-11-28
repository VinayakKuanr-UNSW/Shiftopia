/**
 * Pay rate cards — the rate-card API for the rate-admin Versions tab
 * (migration *_rate_cards_per_period; docs/architecture/multi-organization.md
 * §11.1 R8/R9, R12).
 *
 * Lists the organization's cards — drafts included, which row-level security
 * returns only to payroll.manage holders (`can_read_rate_card`) — with their
 * rate, allowance, trainee and loadings lines, and calls the RPCs:
 *   roll_rate_card_forward → a draft (every figure × multiplier, to cents)
 *   publish_rate_card      → closes the open-ended predecessor at valid_from − 1
 *   discard_rate_card      → drafts only
 *   authoring (*_rate_card_authoring): create, copy, edit meta / rates /
 *   allowances / trainee schedule / loadings, bulk adjust, copy lines — drafts only
 * The database is the authority: every gate and rule lives in those functions.
 */

import { supabase } from '@/platform/supabase/client';
import {
  mapDbLoadingsRow, type RateCardLoadings,
} from '@/modules/rosters/domain/projections/utils/cost/loadings';

import { RATE_CARD_SELECT } from './rateCards.select';

export { RATE_CARD_SELECT };

export type RateCardStatus = 'draft' | 'published';

export type EmploymentBasis = 'permanent' | 'casual' | 'annualised';

export interface RateCardRate {
  classification: string;
  employmentBasis: string;
  ordinaryHourlyRate: number;
  paidHourlyRate: number;
  /** A casual paid rate deliberately off ordinary × (1 + casual loading). */
  isManualOverride: boolean;
  notes: string | null;
}

export interface RateCardAllowance {
  code: string;
  amount: number;
  unit: string;
  notes: string | null;
}

export interface RateCardTrainee {
  label: string | null;
  source: string | null;
  matrix: Record<string, unknown>;
}

export interface RateCard {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  currency: string;
  ruleSet: string;
  validFrom: string;          // YYYY-MM-DD
  validTo: string | null;     // null = open-ended, until the next card
  status: RateCardStatus;
  derivation: string | null;  // e.g. 'ICC-EA-2026-27 × 1.042'
  publishedAt: string | null;
  notes: string | null;
  /** cl 25.3: when someone confirmed the rates sit at least 2% above the Award. */
  awardFloorCheckedAt: string | null;
  rates: RateCardRate[];
  allowances: RateCardAllowance[];
  /** pay_rate_card_loadings (1:1). null: none yet — publish_rate_card refuses such a card. */
  loadings: RateCardLoadings | null;
  trainee: RateCardTrainee | null;
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
const oneToOne = (v: unknown): Record<string, unknown> | null =>
  ((Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined) ?? null;

const toLoadings = (v: unknown): RateCardLoadings | null => {
  const row = oneToOne(v);
  return row ? mapDbLoadingsRow(row) : null;
};

const toTrainee = (v: unknown): RateCardTrainee | null => {
  const row = oneToOne(v);
  if (!row) return null;
  return {
    label: (row.label as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    matrix: (row.matrix as Record<string, unknown>) ?? {},
  };
};

const ymd = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

function toRateCard(row: any): RateCard {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    code: String(row.code),
    name: String(row.name),
    currency: String(row.currency ?? 'AUD'),
    ruleSet: String(row.rule_set ?? ''),
    validFrom: ymd(row.valid_from) ?? '',
    validTo: ymd(row.valid_to),
    status: row.status === 'published' ? 'published' : 'draft',
    derivation: row.derivation ?? null,
    publishedAt: row.published_at ?? null,
    notes: row.notes ?? null,
    awardFloorCheckedAt: row.award_floor_checked_at ?? null,
    rates: ((row.eba_rate ?? []) as any[]).map((r) => ({
      classification: String(r.classification),
      employmentBasis: String(r.employment_basis),
      ordinaryHourlyRate: num(r.ordinary_hourly_rate),
      paidHourlyRate: num(r.paid_hourly_rate),
      isManualOverride: r.is_manual_override === true,
      notes: r.notes ?? null,
    })),
    allowances: ((row.eba_allowance ?? []) as any[]).map((a) => ({
      code: String(a.code),
      amount: num(a.amount),
      unit: String(a.unit),
      notes: a.notes ?? null,
    })),
    loadings: toLoadings(row.pay_rate_card_loadings),
    trainee: toTrainee(row.eba_trainee_schedule),
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

// ── Authoring (drafts only; the database refuses everything else) ─────────

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface NewRateCardInput {
  organizationId: string;
  code: string;
  name: string;
  validFrom: string;          // YYYY-MM-DD
  currency?: string;
  notes?: string;
}

/** A blank draft carrying the rule set's default loadings; returns its id. */
export const createRateCard = (i: NewRateCardInput) =>
  rpc<string>('create_rate_card', {
    p_org_id: i.organizationId, p_code: i.code.trim(), p_name: i.name.trim(), p_valid_from: i.validFrom,
    p_currency: i.currency ?? 'AUD', p_rule_set: 'icc_sydney_ea', p_notes: i.notes?.trim() || null,
  }).then(String);

export interface CopyRateCardInput {
  sourceCardId: string;
  targetOrganizationId?: string | null;   // default: the source's organization
  code: string;
  name: string;
  validFrom: string;
  rates?: boolean;
  allowances?: boolean;
  trainee?: boolean;
  multiplier?: number;
}

export const copyRateCard = (i: CopyRateCardInput) =>
  rpc<string>('copy_rate_card', {
    p_source_card_id: i.sourceCardId, p_target_org_id: i.targetOrganizationId ?? null,
    p_code: i.code.trim(), p_name: i.name.trim(), p_valid_from: i.validFrom,
    p_options: {
      rates: i.rates ?? true, allowances: i.allowances ?? true, trainee: i.trainee ?? true,
      multiplier: i.multiplier ?? 1,
    },
  }).then(String);

export interface RateCardMetaPatch {
  code?: string;
  name?: string;
  currency?: string;
  validFrom?: string;
  validTo?: string | null;
  notes?: string | null;
  awardFloorChecked?: boolean;
}

export const updateRateCardMeta = (cardId: string, patch: RateCardMetaPatch) => {
  const body: Record<string, unknown> = {};
  if (patch.code !== undefined) body.code = patch.code;
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.currency !== undefined) body.currency = patch.currency;
  if (patch.validFrom !== undefined) body.valid_from = patch.validFrom;
  if (patch.validTo !== undefined) body.valid_to = patch.validTo;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.awardFloorChecked !== undefined) body.award_floor_checked = patch.awardFloorChecked;
  return rpc<void>('update_rate_card_meta', { p_card_id: cardId, p_patch: body });
};

export interface RateLineInput {
  classification: string;
  employmentBasis: EmploymentBasis;
  ordinaryHourlyRate: number;
  /** Omitted: permanent = ordinary, casual = ordinary × (1 + casual loading). */
  paidHourlyRate?: number;
  isManualOverride?: boolean;
  notes?: string | null;
}

export const upsertRateCardRates = (cardId: string, lines: RateLineInput[]) =>
  rpc<number>('upsert_rate_card_rates', {
    p_card_id: cardId,
    p_items: lines.map((l) => ({
      classification: l.classification,
      employment_basis: l.employmentBasis,
      ordinary_hourly_rate: l.ordinaryHourlyRate,
      ...(l.paidHourlyRate !== undefined ? { paid_hourly_rate: l.paidHourlyRate } : {}),
      ...(l.isManualOverride !== undefined ? { is_manual_override: l.isManualOverride } : {}),
      ...(l.notes !== undefined ? { notes: l.notes } : {}),
    })),
  });

export interface AllowanceLineInput {
  code: string;
  amount: number;
  unit: string;
  notes?: string | null;
}

export const upsertRateCardAllowances = (cardId: string, lines: AllowanceLineInput[]) =>
  rpc<number>('upsert_rate_card_allowances', {
    p_card_id: cardId,
    p_items: lines.map((l) => ({
      code: l.code, amount: l.amount, unit: l.unit, ...(l.notes !== undefined ? { notes: l.notes } : {}),
    })),
  });

export const deleteRateCardItems = (
  cardId: string,
  rates: Array<{ classification: string; employmentBasis: string }>,
  allowanceCodes: string[] = [],
) =>
  rpc<number>('delete_rate_card_items', {
    p_card_id: cardId,
    p_rates: rates.map((r) => ({ classification: r.classification, employment_basis: r.employmentBasis })),
    p_allowance_codes: allowanceCodes,
  });

/** null classifications = every line. */
export const bulkAdjustRateCardRates = (cardId: string, classifications: string[] | null, multiplier: number) =>
  rpc<number>('bulk_adjust_rate_card_rates', {
    p_card_id: cardId, p_classifications: classifications, p_multiplier: multiplier,
  });

export const copyRateCardItems = (targetCardId: string, sourceCardId: string, classifications: string[], allowanceCodes: string[] = []) =>
  rpc<number>('copy_rate_card_items', {
    p_target_card_id: targetCardId, p_source_card_id: sourceCardId,
    p_classifications: classifications, p_allowance_codes: allowanceCodes,
  });

export const updateRateCardTraineeSchedule = (cardId: string, trainee: RateCardTrainee) =>
  rpc<void>('update_rate_card_trainee_schedule', {
    p_card_id: cardId, p_matrix: trainee.matrix, p_label: trainee.label, p_source: trainee.source,
  });

/** camelCase loadings → the table's snake_case columns (update_rate_card_loadings). */
export const toDbLoadingsPatch = (patch: Partial<RateCardLoadings>): Record<string, number> =>
  Object.fromEntries(Object.entries(patch).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()), v as number]));

export const updateRateCardLoadings = (cardId: string, patch: Partial<RateCardLoadings>) =>
  rpc<void>('update_rate_card_loadings', { p_card_id: cardId, p_loadings: toDbLoadingsPatch(patch) });

export interface SandboxShift {
  shiftDate: string;          // YYYY-MM-DD
  startTime: string;          // HH:MM
  minutes: number;
  baseRate: number;           // the line's paid hourly rate
  employmentType: 'Casual' | 'FT' | 'PT';
}

/**
 * One shift priced by the database's own engine (fn_eba_estimate_shift_cost)
 * against a given card — draft or published — and jurisdiction. null when
 * the card cannot price it.
 */
export async function estimateShiftCost(cardId: string, jurisdiction: string, s: SandboxShift): Promise<number | null> {
  const data = await rpc<number | string | null>('fn_eba_estimate_shift_cost', {
    p_shift_date: s.shiftDate, p_start_time: s.startTime, p_net_minutes: s.minutes, p_scheduled_minutes: s.minutes,
    p_base_rate: s.baseRate, p_employment_type: s.employmentType, p_rate_card_id: cardId, p_jurisdiction: jurisdiction,
  });
  return data == null ? null : Number(data);
}

/** The organization's public-holiday jurisdiction (e.g. AU-NSW), which pricing needs. */
export async function getOrganizationJurisdiction(organizationId: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from('organizations').select('jurisdiction').eq('id', organizationId).maybeSingle();
  if (error) throw error;
  return (data?.jurisdiction as string | null) ?? null;
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
