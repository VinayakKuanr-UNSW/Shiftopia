#!/usr/bin/env node
/**
 * gen-au-holidays.mjs — bake the public-holiday tables into source
 * ────────────────────────────────────────────────────────────────────────────
 * Emits `src/modules/core/lib/holidays.generated.ts`: one table per
 * jurisdiction the platform's organizations sit in, the same set and rules as
 * `public.public_holidays` (docs/architecture/multi-organization.md §3, §5).
 *
 *   AU          Australia: no days of its own (national days sit on the states)
 *   AU-NSW      date-holidays AU/NSW, type "public"
 *   AU-QLD      date-holidays AU/QLD, type "public", less Christmas Eve
 *               (Queensland observes it from 6pm only; tables hold whole days)
 *   AU-QLD-BNE  Brisbane, under AU-QLD: the Ekka (Royal Queensland Show day)
 *               only — a jurisdiction holds its OWN days; a lookup adds its
 *               parents'.
 *
 * WHY BAKED: `core/lib/holidays.ts` used to `new Holidays('AU', 'NSW')` at module
 * scope, which pulled date-holidays → date-holidays-parser → moment-timezone +
 * astronomia (1,380 KB, 57% of the eager entry chunk) into the browser to answer
 * a dozen dates a year. They are resolved here, at build time, with the same
 * library; `date-holidays` stays a devDependency.
 *
 * Only `type === 'public'` entries are emitted. date-holidays also reports
 * `observance` (Mother's Day, Father's Day) and `bank` (NSW August Bank
 * Holiday); those are NOT public holidays and must never attract public-holiday
 * penalty rates. See holidays-generated-parity.test.ts.
 *
 * Usage:
 *   node scripts/gen-au-holidays.mjs           # rewrite the generated module
 *   node scripts/gen-au-holidays.mjs --check   # exit 1 if out of date
 *   npm run gen:holidays
 *
 * `buildHolidayTables()` and `ekkaDate()` are exported for the parity tests —
 * keep those exports stable.
 */
import Holidays from 'date-holidays';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/modules/core/lib/holidays.generated.ts');

/**
 * Coverage window. Back far enough for historical timesheet/payroll and
 * fairness-ledger lookups, forward far enough that nobody alive will hit the
 * edge unnoticed — `holidays.test.ts` fails if the forward margin ever drops
 * below 10 years.
 */
export const MIN_YEAR = 2010;
export const MAX_YEAR = 2075;

/**
 * Brisbane's Ekka is the Wednesday of the Royal Queensland Show, which starts on
 * the first Friday of August, or the second when the first falls before 5 August
 * — i.e. the first Friday on or after 5 August. Reproduces the gazetted 2024–2026
 * dates; the government can move the day (it did in 2020–2021), so years are
 * emitted from EKKA_FROM, the first year an organization needs them.
 */
export const EKKA_FROM = 2024;

/** @param {number} year @returns {string} YYYY-MM-DD */
export function ekkaDate(year) {
  const aug5 = new Date(Date.UTC(year, 7, 5));
  const toFriday = (5 - aug5.getUTCDay() + 7) % 7;
  const wednesday = new Date(Date.UTC(year, 7, 5 + toFriday + 5));
  return wednesday.toISOString().slice(0, 10);
}

/** Jurisdiction → parent. A lookup in a jurisdiction also matches its parents. */
export const JURISDICTION_PARENTS = {
  'AU': null,
  'AU-NSW': 'AU',
  'AU-QLD': 'AU',
  'AU-QLD-BNE': 'AU-QLD',
};

function libraryPublic(state, skipNames = []) {
  const hd = new Holidays('AU', state);
  const out = [];
  for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
    for (const entry of hd.getHolidays(year)) {
      if (entry.type !== 'public' || skipNames.includes(entry.name)) continue;
      out.push([entry.date.slice(0, 10), entry.name]);
    }
  }
  return out;
}

/** @returns {Array<[string, string]>} the [date, name] entries of one jurisdiction's OWN days */
function entriesFor(jurisdiction) {
  switch (jurisdiction) {
    // National days stay on the state tables (as in public_holidays); AU holds none.
    case 'AU': return [];
    case 'AU-NSW': return libraryPublic('NSW');
    case 'AU-QLD': return libraryPublic('QLD', ['Christmas Eve']);
    case 'AU-QLD-BNE': {
      const out = [];
      for (let year = EKKA_FROM; year <= MAX_YEAR; year++) out.push([ekkaDate(year), 'Royal Queensland Show (Ekka)']);
      return out;
    }
    default: throw new Error(`no holiday rule for ${jurisdiction}`);
  }
}

/** @returns {{ names: string[], byJurisdiction: Record<string, Record<string, number>> }} */
export function buildHolidayTables() {
  const names = [];
  const nameIndex = new Map();
  const byJurisdiction = {};

  for (const jurisdiction of Object.keys(JURISDICTION_PARENTS)) {
    const byDate = {};
    for (const [key, name] of entriesFor(jurisdiction)) {
      // A rule can resolve into an adjacent year (e.g. a substitute day rolling
      // into 1 Jan). Keep it only if it lands inside the window.
      const y = Number(key.slice(0, 4));
      if (y < MIN_YEAR || y > MAX_YEAR) continue;
      let idx = nameIndex.get(name);
      if (idx === undefined) {
        idx = names.length;
        names.push(name);
        nameIndex.set(name, idx);
      }
      byDate[key] = idx;
    }
    byJurisdiction[jurisdiction] = byDate;
  }
  return { names, byJurisdiction };
}

function packYears(byDate) {
  const byYear = new Map();
  for (const k of Object.keys(byDate).sort()) {
    const y = k.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    // Store 'MMDD:idx' — the year is the enclosing key, so it is not repeated.
    byYear.get(y).push(`${k.slice(5, 7)}${k.slice(8, 10)}:${byDate[k]}`);
  }
  return [...byYear.entries()].map(([y, entries]) => `    ${y}: '${entries.join(',')}',`).join('\n');
}

function render({ names, byJurisdiction }) {
  const counts = Object.entries(byJurisdiction).map(([j, d]) => `${j} ${Object.keys(d).length}`).join(' · ');
  const blocks = Object.entries(byJurisdiction)
    .map(([j, byDate]) => `  '${j}': {\n${packYears(byDate)}\n  },`)
    .join('\n');

  return `/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: \`node scripts/gen-au-holidays.mjs\` (npm run gen:holidays): each
 * jurisdiction's OWN public holidays (\`type === 'public'\` from \`date-holidays\`,
 * plus the rules documented in that script). A lookup adds the parents' days.
 *
 * Regenerate after bumping \`date-holidays\`, or when a state legislates a new or
 * one-off public holiday. \`holidays-generated-parity.test.ts\` fails the build
 * if this file drifts from what the rules produce.
 *
 * Coverage: ${MIN_YEAR}–${MAX_YEAR} · ${counts} · ${names.length} distinct names.
 */

/** Distinct holiday names, referenced by index from \`PACKED_BY_JURISDICTION\`. */
export const HOLIDAY_NAMES: readonly string[] = ${JSON.stringify(names, null, 2)};

/** Jurisdiction → parent jurisdiction (null at the top). */
export const JURISDICTION_PARENTS: Readonly<Record<string, string | null>> = ${JSON.stringify(JURISDICTION_PARENTS, null, 2)};

/**
 * Jurisdiction → year → packed \`"MMDD:nameIdx"\` entries, comma separated.
 *
 * Packed rather than a flat \`Record<'YYYY-MM-DD', string>\` so the module is a
 * few small strings the engine parses in microseconds. It is unpacked lazily,
 * one (jurisdiction, year) at a time, on first lookup.
 */
export const PACKED_BY_JURISDICTION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
${blocks}
};

export const MIN_YEAR = ${MIN_YEAR};
export const MAX_YEAR = ${MAX_YEAR};
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const tables = buildHolidayTables();
  const output = render(tables);

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== output) {
      console.error('holidays.generated.ts is OUT OF DATE — run `npm run gen:holidays`');
      process.exit(1);
    }
    console.log('holidays.generated.ts is up to date.');
  } else {
    fs.writeFileSync(OUT, output);
    const counts = Object.entries(tables.byJurisdiction).map(([j, d]) => `${j} ${Object.keys(d).length}`).join(', ');
    console.log(`Wrote ${path.relative(process.cwd(), OUT)} — ${counts}; ${MIN_YEAR}–${MAX_YEAR}, ${(output.length / 1024).toFixed(1)} KB.`);
  }
}
