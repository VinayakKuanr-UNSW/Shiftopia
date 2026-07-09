#!/usr/bin/env node
/**
 * gen-eba-rate-schedule.mjs — EBA rate/allowance drift guard (generator half)
 * ────────────────────────────────────────────────────────────────────────────
 * Parses the seeded rows out of the effective-dated migration
 *
 *   supabase/migrations/20260709000000_eba_rate_allowance_effective_dated.sql
 *
 * (`INSERT INTO public.eba_rate ... VALUES (...)` and the matching
 * `public.eba_allowance` insert) and emits the canonical EA-2025 rate/allowance
 * dataset in the exact shape the worker-safe cost engine's `RateSet` exposes
 * (`RATE_SCHEDULE[0]` from rate-schedule.ts).
 *
 * WHY: there are two copies of the EA 2025 rates — the durable DB migration and
 * the static in-code TS schedule the (synchronous, worker-safe) cost engine
 * reads. The engine cannot read the DB at runtime, so the copy must stay static;
 * this script + the sync test (rate-schedule-sync.test.ts) make any divergence
 * between the two machine-checkable rather than a silent manual-sync hazard.
 *
 * Dependency-light: Node built-ins only (fs, path, url). No SQL client — the
 * migration is parsed as text so this runs anywhere with plain Node.
 *
 * Usage:
 *   node scripts/gen-eba-rate-schedule.mjs            # pretty-print JSON to stdout
 *   node scripts/gen-eba-rate-schedule.mjs --json     # (same; explicit)
 *   npm run gen:eba-rates
 *
 * The emitted object is ALSO consumed programmatically by the sync test via the
 * exported `deriveRateSetFromMigration()` — keep that export stable.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the effective-dated seed migration. */
export const MIGRATION_PATH = resolve(
  __dirname,
  '../supabase/migrations/20260709000000_eba_rate_allowance_effective_dated.sql',
);

/** The baseline effective row this dataset represents (EA 2025 commencement). */
export const BASELINE_EFFECTIVE_FROM = '2025-01-01';

/**
 * Extract the `VALUES ( ... )` tuple list for a given
 * `INSERT INTO "public"."<table>" (...) VALUES <tuples>;` statement.
 *
 * Returns an array of tuples, each tuple an array of raw (un-typed) string
 * cells. SQL line-comments (`-- ...`) inside the VALUES block are stripped.
 */
function parseInsertValues(sql, table) {
  // Match:  INSERT INTO "public"."eba_rate" ( ...cols... ) VALUES <body> ;
  // Table/schema identifiers may be quoted or bare; whitespace/newlines vary.
  const re = new RegExp(
    'INSERT\\s+INTO\\s+"?public"?\\.\\s*"?' +
      table +
      '"?\\s*\\([^)]*\\)\\s*VALUES\\b([\\s\\S]*?);',
    'i',
  );
  const m = re.exec(sql);
  if (!m) throw new Error(`Could not find INSERT INTO public.${table} ... VALUES in migration`);

  // Strip SQL line comments so a trailing `-- note` never bleeds into a cell.
  const body = m[1].replace(/--[^\n]*\n/g, '\n');

  const tuples = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        // Handle SQL escaped quote ''.
        if (body[i + 1] === "'") {
          cur += body[++i];
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
    } else if (ch === '(') {
      if (depth === 0) cur = '';
      else cur += ch;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        tuples.push(splitCells(cur));
        cur = '';
      } else {
        cur += ch;
      }
    } else if (depth > 0) {
      cur += ch;
    }
  }
  return tuples;
}

/** Split one tuple body into cells on top-level commas (respecting strings). */
function splitCells(tuple) {
  const cells = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inStr) {
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inStr = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === ',') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const num = (s) => Number(s);

/**
 * Derive the EA-2025 RateSet-shaped dataset from the migration SQL text.
 * Pure: takes the SQL string (defaults to reading MIGRATION_PATH) and returns
 * the same shape as RATE_SCHEDULE[0] (minus the label/source/effectiveFrom
 * provenance strings, which the sync test compares separately).
 */
export function deriveRateSetFromMigration(sql = readFileSync(MIGRATION_PATH, 'utf8')) {
  // eba_rate cols: effective_from, classification, employment_basis,
  //                ordinary_hourly_rate, paid_hourly_rate, source
  const rateRows = parseInsertValues(sql, 'eba_rate')
    .map(([effective_from, classification, employment_basis, ordinary, paid]) => ({
      effective_from,
      classification,
      employment_basis,
      ordinary_hourly_rate: num(ordinary),
      paid_hourly_rate: num(paid),
    }))
    .filter((r) => r.effective_from === BASELINE_EFFECTIVE_FROM);

  // eba_allowance cols: effective_from, code, amount, unit, source
  const allowanceRows = parseInsertValues(sql, 'eba_allowance')
    .map(([effective_from, code, amount, unit]) => ({
      effective_from,
      code,
      amount: num(amount),
      unit,
    }))
    .filter((r) => r.effective_from === BASELINE_EFFECTIVE_FROM);

  // ── wageRates: LEVEL_1..7 + TRAINEE, permanent + casual ────────────────────
  // In the RateSet a classification's `permanent`/`casual` value is the rate
  // actually PAID at ordinary time (casual includes the 25% loading), which is
  // the migration's paid_hourly_rate column.
  const wageRates = {};
  for (const row of rateRows) {
    if (row.employment_basis === 'annualised') continue; // security handled below
    const key = row.classification; // 'TRAINEE' | 'LEVEL_1'..'LEVEL_7'
    if (!wageRates[key]) wageRates[key] = {};
    wageRates[key][row.employment_basis] = row.paid_hourly_rate;
  }

  // defaultRate = Level 1 casual paid rate (constants.ts: DEFAULT_RATE = 32.06).
  const defaultRate = wageRates.LEVEL_1?.casual;

  // ── allowances ─────────────────────────────────────────────────────────────
  const byCode = Object.fromEntries(allowanceRows.map((a) => [a.code, a.amount]));
  const allowances = {
    meal: byCode.meal,
    firstAidPerHour: byCode.first_aid_per_hour,
    proteinSpill: byCode.protein_spill,
    splitShift: byCode.split_shift,
  };

  // ── security: annualisedHourly + ordinaryFromAnnualised ────────────────────
  // SECURITY_LEVEL_3..6 (annualised): paid = annualised hourly, ordinary = the
  // equivalent ordinary rate keyed by the annualised value.
  const secLevelKey = { SECURITY_LEVEL_3: 'level3', SECURITY_LEVEL_4: 'level4', SECURITY_LEVEL_5: 'level5', SECURITY_LEVEL_6: 'level6' };
  const annualisedHourly = {};
  const ordinaryFromAnnualised = {};
  for (const row of rateRows) {
    if (row.employment_basis !== 'annualised') continue;
    const key = secLevelKey[row.classification];
    if (!key) continue;
    annualisedHourly[key] = row.paid_hourly_rate;
    ordinaryFromAnnualised[row.paid_hourly_rate] = row.ordinary_hourly_rate;
  }

  return {
    effectiveFrom: BASELINE_EFFECTIVE_FROM,
    defaultRate,
    wageRates,
    allowances,
    security: { annualisedHourly, ordinaryFromAnnualised },
    _counts: {
      wageRows: rateRows.filter((r) => r.employment_basis !== 'annualised').length,
      securityRows: rateRows.filter((r) => r.employment_basis === 'annualised').length,
      allowanceRows: allowanceRows.length,
    },
  };
}

// ── CLI entry point ──────────────────────────────────────────────────────────
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dataset = deriveRateSetFromMigration();
  process.stdout.write(JSON.stringify(dataset, null, 2) + '\n');
}
