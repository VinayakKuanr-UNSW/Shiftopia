#!/usr/bin/env node
/**
 * gen-au-nsw-holidays.mjs — bake the AU/NSW public-holiday table into source
 * ────────────────────────────────────────────────────────────────────────────
 * Emits `src/modules/core/lib/holidays.generated.ts` from `date-holidays`.
 *
 * WHY: `core/lib/holidays.ts` used to `new Holidays('AU', 'NSW')` at MODULE
 * SCOPE. That is correct but ruinously expensive on the web:
 *
 *   date-holidays  →  date-holidays-parser  →  moment-timezone + astronomia
 *
 * pulled 1,380 KB into the EAGER entry chunk — 57% of it — to answer questions
 * about one state of one country, and then parsed a 722 KB world holiday
 * dataset before the app could paint. (Measured via the production sourcemap:
 * moment-timezone 715 KB, date-holidays 335 KB, astronomia 142 KB, lodash
 * 72 KB, moment 60 KB, date-holidays-parser 57 KB.)
 *
 * Nothing about NSW holidays needs to be computed in the browser: they are a
 * dozen dates a year, known decades ahead. So we resolve them here, at build
 * time, with the same library — the runtime keeps the identical answers and
 * `date-holidays` moves to devDependencies.
 *
 * Only `type === 'public'` entries are emitted. date-holidays also reports
 * `observance` (Mother's Day, Father's Day) and `bank` (NSW August Bank
 * Holiday); those are NOT public holidays and must never attract public-holiday
 * penalty rates. See holidays-generated-parity.test.ts.
 *
 * Usage:
 *   node scripts/gen-au-nsw-holidays.mjs      # rewrite the generated module
 *   node scripts/gen-au-nsw-holidays.mjs --check   # exit 1 if out of date
 *   npm run gen:holidays
 *
 * `buildHolidayTable()` is exported so the parity test can rebuild the table
 * in-memory and diff it against the committed file — keep that export stable.
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
 * edge unnoticed — and `holidays.test.ts` fails if the forward margin ever
 * drops below 10 years, which is the real guard.
 */
export const MIN_YEAR = 2010;
export const MAX_YEAR = 2075;

/** @returns {{ names: string[], byDate: Record<string, number> }} */
export function buildHolidayTable() {
  const hd = new Holidays('AU', 'NSW');
  const names = [];
  const nameIndex = new Map();
  const byDate = {};

  for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
    for (const entry of hd.getHolidays(year)) {
      if (entry.type !== 'public') continue;
      const key = entry.date.slice(0, 10);
      // A rule can resolve into an adjacent year (e.g. a substitute day rolling
      // into 1 Jan). Keep it only if it lands inside the window.
      const y = Number(key.slice(0, 4));
      if (y < MIN_YEAR || y > MAX_YEAR) continue;
      let idx = nameIndex.get(entry.name);
      if (idx === undefined) {
        idx = names.length;
        names.push(entry.name);
        nameIndex.set(entry.name, idx);
      }
      byDate[key] = idx;
    }
  }
  return { names, byDate };
}

function render({ names, byDate }) {
  const keys = Object.keys(byDate).sort();
  const byYear = new Map();
  for (const k of keys) {
    const y = k.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    // Store 'MMDD:idx' — the year is the enclosing key, so it is not repeated.
    byYear.get(y).push(`${k.slice(5, 7)}${k.slice(8, 10)}:${byDate[k]}`);
  }
  const rows = [...byYear.entries()]
    .map(([y, entries]) => `  ${y}: '${entries.join(',')}',`)
    .join('\n');

  return `/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: \`node scripts/gen-au-nsw-holidays.mjs\` (npm run gen:holidays),
 * which resolves AU/NSW \`type === 'public'\` holidays out of \`date-holidays\`.
 *
 * Regenerate after bumping \`date-holidays\`, or when NSW legislates a new or
 * one-off public holiday. \`holidays-generated-parity.test.ts\` fails the build
 * if this file drifts from what the library produces.
 *
 * Coverage: ${MIN_YEAR}–${MAX_YEAR} · ${keys.length} public holidays · ${names.length} distinct names.
 */

/** Distinct holiday names, referenced by index from \`PACKED_BY_YEAR\`. */
export const HOLIDAY_NAMES: readonly string[] = ${JSON.stringify(names, null, 2).replace(/\n/g, '\n')};

/**
 * Year → packed \`"MMDD:nameIdx"\` entries, comma separated.
 *
 * Packed rather than a flat \`Record<'YYYY-MM-DD', string>\` so the module is a
 * few small strings the engine parses in microseconds, instead of ~800 object
 * properties it must allocate and hash at startup. It is unpacked lazily, one
 * year at a time, on first lookup for that year.
 */
export const PACKED_BY_YEAR: Readonly<Record<string, string>> = {
${rows}
};

export const MIN_YEAR = ${MIN_YEAR};
export const MAX_YEAR = ${MAX_YEAR};
`;
}

const table = buildHolidayTable();
const output = render(table);

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== output) {
    console.error('holidays.generated.ts is OUT OF DATE — run `npm run gen:holidays`');
    process.exit(1);
  }
  console.log('holidays.generated.ts is up to date.');
} else {
  fs.writeFileSync(OUT, output);
  const n = Object.keys(table.byDate).length;
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} — ${n} public holidays, ${MIN_YEAR}–${MAX_YEAR}, ${(output.length / 1024).toFixed(1)} KB.`);
}
