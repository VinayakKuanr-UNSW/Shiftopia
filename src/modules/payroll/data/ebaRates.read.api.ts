/**
 * EBA rate schedule — read adapter for the rate-admin UI.
 *
 * Reads the organization's PUBLISHED pay rate cards (`public.pay_rate_cards`,
 * migration *_rate_cards_per_period) with their lines (`eba_rate`,
 * `eba_allowance`, `eba_trainee_schedule`). Each card is one period's rates, so
 * each becomes one `EbaRateSet` dated by the card's `valid_from`, ascending.
 *
 * SCOPE: READ-ONLY. New periods are made through the rate-card API —
 * `roll_rate_card_forward` → `publish_rate_card` (payroll.manage) — not here.
 * The worker cost engine still reads an EMBEDDED copy of these rates
 * (`rate-schedule.ts` → RATE_SCHEDULE); moving it onto the cards is phase 2.
 */

import { supabase } from '@/platform/supabase/client';
import {
  TRAINEE_RATE_SCHEDULE,
  type TraineeRateSet,
} from '@/modules/rosters/domain/projections/utils/cost/trainee_matrix';

export type { TraineeRateSet } from '@/modules/rosters/domain/projections/utils/cost/trainee_matrix';

/** One classification's rates at a given effective date (both employment bases). */
export interface EbaRateRow {
  classification: string;          // 'TRAINEE' | 'LEVEL_1'..'LEVEL_7' | 'SECURITY_LEVEL_3'..'6'
  employmentBasis: 'permanent' | 'casual' | 'annualised';
  /** De-loaded ordinary hourly rate (used for overtime/penalty maths). */
  ordinaryHourlyRate: number;
  /** Rate actually paid at ordinary time (casual includes the 25% loading). */
  paidHourlyRate: number;
  source: string | null;
}

export interface EbaAllowanceRow {
  code: string;                    // 'meal' | 'first_aid_per_hour' | 'protein_spill' | 'split_shift'
  amount: number;
  unit: string;                    // 'per_occasion' | 'per_hour' | 'per_shift'
  source: string | null;
}

/** One published card's rates + allowances, in force from `effectiveFrom` until the next card. */
export interface EbaRateSet {
  effectiveFrom: string;           // YYYY-MM-DD
  rates: EbaRateRow[];
  allowances: EbaAllowanceRow[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ymd = (v: unknown): string => {
  const s = String(v ?? '');
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
};

/**
 * Fetch the organization's published rate cards as rate sets, ascending by the
 * card's `valid_from`. Returns `[]` with no organization, or on error
 * (fail-soft — the admin UI shows an empty state rather than throwing).
 */
export async function getEbaRateSchedule(organizationId: string | null): Promise<EbaRateSet[]> {
  if (!organizationId) return [];
  const { data, error } = await (supabase as any)
    .from('pay_rate_cards')
    .select('valid_from, eba_rate(classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source), eba_allowance(code, amount, unit, source)')
    .eq('organization_id', organizationId)
    .eq('status', 'published')
    .order('valid_from', { ascending: true });

  if (error) {
    console.error('[ebaRates.read] pay_rate_cards query error:', error);
    return [];
  }

  return ((data ?? []) as any[]).map((card) => ({
    effectiveFrom: ymd(card.valid_from),
    rates: ((card.eba_rate ?? []) as any[])
      .map((r): EbaRateRow => ({
        classification: String(r.classification),
        employmentBasis: r.employment_basis,
        ordinaryHourlyRate: num(r.ordinary_hourly_rate),
        paidHourlyRate: num(r.paid_hourly_rate),
        source: r.source ?? null,
      }))
      .sort((a, b) => a.classification.localeCompare(b.classification)),
    allowances: ((card.eba_allowance ?? []) as any[])
      .map((a): EbaAllowanceRow => ({
        code: String(a.code),
        amount: num(a.amount),
        unit: String(a.unit),
        source: a.source ?? null,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  }));
}

/**
 * The set in force on `date` — the one with the latest `effectiveFrom` on or
 * before it. Mirrors `resolveRateSet` in the cost engine (ISO strings compare
 * lexicographically). Dates before the earliest set fall back to the earliest.
 */
export function resolveEbaRateSetOnDate(
  schedule: EbaRateSet[],
  date: string,
): EbaRateSet | null {
  if (schedule.length === 0) return null;
  const d = ymd(date);
  let applicable: EbaRateSet | null = null;
  for (const s of schedule) {
    if (s.effectiveFrom <= d && (!applicable || s.effectiveFrom > applicable.effectiveFrom)) {
      applicable = s;
    }
  }
  return applicable ?? schedule[0];
}

/**
 * Fetch the Schedule 5 trainee schedule from the organization's published cards
 * (one JSONB matrix per card, dated by the card's `valid_from`). On any error
 * or empty result falls back to the embedded `TRAINEE_RATE_SCHEDULE` the engine
 * uses; the rate-schedule-trainee-sync drift guard keeps the two identical.
 */
export async function getTraineeRateSchedule(organizationId: string | null): Promise<TraineeRateSet[]> {
  if (!organizationId) return TRAINEE_RATE_SCHEDULE;
  try {
    const { data, error } = await (supabase as any)
      .from('pay_rate_cards')
      .select('valid_from, eba_trainee_schedule(matrix, label, source)')
      .eq('organization_id', organizationId)
      .eq('status', 'published')
      .order('valid_from', { ascending: true });
    if (error || !data) return TRAINEE_RATE_SCHEDULE;
    // One schedule per card: PostgREST embeds it as an object (or a one-row array).
    const sets = (data as any[]).flatMap((card) => {
      const row = Array.isArray(card.eba_trainee_schedule) ? card.eba_trainee_schedule[0] : card.eba_trainee_schedule;
      if (!row) return [];
      return [{
        effectiveFrom: ymd(card.valid_from),
        label: row.label ?? '',
        source: row.source ?? '',
        ...(typeof row.matrix === 'string' ? JSON.parse(row.matrix) : row.matrix),
      } as TraineeRateSet];
    });
    return sets.length > 0 ? sets : TRAINEE_RATE_SCHEDULE;
  } catch {
    return TRAINEE_RATE_SCHEDULE;
  }
}
