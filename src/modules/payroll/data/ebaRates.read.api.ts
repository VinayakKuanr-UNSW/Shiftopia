/**
 * EBA rate schedule — read adapter for the Phase-2 rate-admin UI.
 *
 * Reads the durable, effective-dated wage/allowance source of truth from the DB
 * tables `public.eba_rate` + `public.eba_allowance` (migration
 * 20260709000000_eba_rate_allowance_effective_dated.sql) and groups the flat
 * rows into one `EbaRateSet` per `effective_from` date, ascending.
 *
 * SCOPE: this is READ-ONLY. The worker cost engine reads an EMBEDDED copy of
 * these rates (`rate-schedule.ts` → RATE_SCHEDULE) because it runs in a
 * projection worker with no Supabase access; the DB tables only mirror it, and
 * RLS denies authenticated writes (service_role only). So the admin UI views
 * the schedule and PREVIEWS a CPI increase (emitting the migration SQL + TS
 * snippet an engineer applies to BOTH copies) — it never writes rates directly.
 * Making the DB the single writable source is the explicit Phase-3 milestone.
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

/** All rates + allowances in force from `effectiveFrom` until the next set. */
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
 * Fetch the full effective-dated EBA rate schedule from the DB, grouped by
 * `effective_from` (ascending). Returns `[]` on error (fail-soft — the admin UI
 * shows an empty state rather than throwing).
 */
export async function getEbaRateSchedule(): Promise<EbaRateSet[]> {
  const [rateRes, allowanceRes] = await Promise.all([
    (supabase as any)
      .from('eba_rate')
      .select('effective_from, classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, source')
      .order('effective_from', { ascending: true })
      .order('classification', { ascending: true }),
    (supabase as any)
      .from('eba_allowance')
      .select('effective_from, code, amount, unit, source')
      .order('effective_from', { ascending: true })
      .order('code', { ascending: true }),
  ]);

  if (rateRes.error) {
    console.error('[ebaRates.read] eba_rate query error:', rateRes.error);
    return [];
  }
  if (allowanceRes.error) {
    console.error('[ebaRates.read] eba_allowance query error:', allowanceRes.error);
    return [];
  }

  // Group both tables by effective_from into a single map of sets.
  const byDate = new Map<string, EbaRateSet>();
  const setFor = (date: string): EbaRateSet => {
    let s = byDate.get(date);
    if (!s) {
      s = { effectiveFrom: date, rates: [], allowances: [] };
      byDate.set(date, s);
    }
    return s;
  };

  for (const r of (rateRes.data ?? []) as any[]) {
    setFor(ymd(r.effective_from)).rates.push({
      classification: String(r.classification),
      employmentBasis: r.employment_basis,
      ordinaryHourlyRate: num(r.ordinary_hourly_rate),
      paidHourlyRate: num(r.paid_hourly_rate),
      source: r.source ?? null,
    });
  }
  for (const a of (allowanceRes.data ?? []) as any[]) {
    setFor(ymd(a.effective_from)).allowances.push({
      code: String(a.code),
      amount: num(a.amount),
      unit: String(a.unit),
      source: a.source ?? null,
    });
  }

  return [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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
 * Fetch the effective-dated Schedule 5 trainee schedule. Reads the durable
 * `eba_trainee_schedule` (JSONB matrix per effective_from); on any error or
 * empty result — e.g. before the migration is applied — falls back to the
 * embedded `TRAINEE_RATE_SCHEDULE` the engine uses. Both are kept identical by
 * the rate-schedule-trainee-sync drift guard, so the fallback is authoritative.
 */
export async function getTraineeRateSchedule(): Promise<TraineeRateSet[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('eba_trainee_schedule')
      .select('effective_from, matrix, label, source')
      .order('effective_from', { ascending: true });
    if (error || !data || data.length === 0) return TRAINEE_RATE_SCHEDULE;
    return (data as any[]).map((row) => ({
      effectiveFrom: ymd(row.effective_from),
      label: row.label ?? '',
      source: row.source ?? '',
      ...(typeof row.matrix === 'string' ? JSON.parse(row.matrix) : row.matrix),
    })) as TraineeRateSet[];
  } catch {
    return TRAINEE_RATE_SCHEDULE;
  }
}
