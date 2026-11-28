import {
  HOLIDAY_NAMES,
  JURISDICTION_PARENTS,
  PACKED_BY_JURISDICTION,
  MIN_YEAR,
  MAX_YEAR,
} from './holidays.generated';

/**
 * Single source of truth for Australian public holidays across the whole app.
 *
 * One table per jurisdiction (AU-NSW, AU-QLD, Brisbane's AU-QLD-BNE under it),
 * the same set and rules as `public.public_holidays`; a lookup in a jurisdiction
 * includes its parents' days. Every lookup takes the jurisdiction, defaulting
 * to NSW for the callers not yet passing one (DEFAULT_JURISDICTION). This same table backs the payroll/award cost
 * engine, the V8 compliance engine and every calendar surface — public holidays
 * are marked in amber on the shared `Calendar` primitive and the
 * roster/availability grids.
 *
 * HISTORY — this used to be one of three rival implementations:
 *   1. this file (date-holidays AU/NSW, correct and unbounded),
 *   2. `date.utils.ts#isPublicHoliday`, a hard-coded 2026-only list that
 *      returned `false` for Easter/Anzac/King's Birthday/Labour Day in every
 *      other year, and fed `is_public_holiday` into the V8 compliance engine,
 *   3. `anz-holidays.ts`, a 2025–2027 dictionary that also contained NEW
 *      ZEALAND holidays (Waitangi Day, Matariki, NZ Labour Day) and marked them
 *      on the Sydney roster grid.
 * Both (2) and (3) are gone; their entry points now delegate here. Neither
 * carried the NSW substitute days (e.g. Mon 27 Apr 2026 for Anzac Day), which
 * do attract public-holiday penalty rates.
 *
 * WHERE THE DATES COME FROM — still `date-holidays`, but resolved at BUILD time
 * by `scripts/gen-au-holidays.mjs` into `holidays.generated.ts` rather than
 * at module scope in the browser. `new Holidays('AU', 'NSW')` used to run on
 * import, which dragged date-holidays → date-holidays-parser → moment-timezone
 * + astronomia into the eager entry chunk: 1,380 KB of the 2,417 KB bundle
 * (57%), parsed before the app could paint, to answer questions about one state
 * of one country. The generated table is 7.8 KB and the answers are identical —
 * `holidays-generated-parity.test.ts` re-derives it from the library and diffs.
 *
 * ONLY `type === 'public'` IS HERE, and that is load-bearing. date-holidays also
 * reports `observance` (Mother's Day, Father's Day) and `bank` (the NSW August
 * Bank Holiday) for AU/NSW, and its `isHoliday()` returns truthy for all of
 * them. Those days are NOT public holidays and must never attract public-holiday
 * penalty rates — use the helpers below, never a raw library instance.
 */

/** Coverage window of the generated table. Asserted by `holidays.test.ts`. */
export const PUBLIC_HOLIDAY_YEAR_RANGE = { min: MIN_YEAR, max: MAX_YEAR } as const;

/**
 * Fallback jurisdiction when a caller has no organization or explicit
 * jurisdiction context (e.g. legacy unit tests or synthetic previews).
 *
 * Production callers resolve the shift's or selected organization's
 * jurisdiction (`organizations.jurisdiction`, e.g. `AU-QLD-BNE` for BCEC) via
 * `useJurisdiction`, `resolveJurisdiction`, or `fetchOrganizationJurisdictions`
 * and pass it explicitly.
 */
export const DEFAULT_JURISDICTION = 'AU-NSW';

/**
 * The jurisdiction and its parents, nearest first (AU-QLD-BNE → AU-QLD → AU),
 * matching `public.jurisdiction_lineage`. Throws for a code the generated table
 * does not know: answering "not a holiday" for an unknown calendar is the
 * fail-open bug this module exists to prevent.
 */
export function jurisdictionLineage(jurisdiction: string): readonly string[] {
  if (!(jurisdiction in JURISDICTION_PARENTS)) {
    throw new Error(`No public-holiday table for jurisdiction "${jurisdiction}" — run npm run gen:holidays`);
  }
  const lineage: string[] = [];
  for (let j: string | null = jurisdiction; j; j = JURISDICTION_PARENTS[j] ?? null) lineage.push(j);
  return lineage;
}

/**
 * Resolved holiday names keyed by `YYYY-MM-DD`, unpacked one (jurisdiction,
 * year) at a time, with the parents' days merged in (nearest name wins).
 *
 * A calendar asks a lot: a month grid asks 42 times per render and the roster
 * planner asks once per cell across a 31-day range. Unpacking once turns every
 * subsequent lookup into a `Map.get`.
 */
const holidayNamesByJurisdictionYear = new Map<string, Map<string, string>>();

function getYearIndex(year: number, jurisdiction: string): Map<string, string> {
  const cacheKey = `${jurisdiction}|${year}`;
  const cached = holidayNamesByJurisdictionYear.get(cacheKey);
  if (cached) return cached;

  const index = new Map<string, string>();
  for (const level of jurisdictionLineage(jurisdiction)) {
    const packed = PACKED_BY_JURISDICTION[level]?.[String(year)];
    if (!packed) continue;
    for (const entry of packed.split(',')) {
      // 'MMDD:nameIdx' — the year is the key this string was stored under.
      const [mmdd, nameIdx] = entry.split(':');
      const key = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`;
      if (!index.has(key)) index.set(key, HOLIDAY_NAMES[Number(nameIdx)]);
    }
  }
  holidayNamesByJurisdictionYear.set(cacheKey, index);
  return index;
}

/** True when the given date is a public holiday in the jurisdiction (NSW by default). */
export function isPublicHoliday(date: Date, jurisdiction: string = DEFAULT_JURISDICTION): boolean {
  if (Number.isNaN(date.getTime())) return false;
  return getYearIndex(date.getFullYear(), jurisdiction).has(toDateKey(date));
}

/** Local-field `YYYY-MM-DD` key — never via `toISOString()`, which shifts to UTC. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Human-readable name of the public holiday on a date, or null if none. */
export function getPublicHolidayName(date: Date, jurisdiction: string = DEFAULT_JURISDICTION): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return getYearIndex(date.getFullYear(), jurisdiction).get(toDateKey(date)) ?? null;
}

/**
 * As `isPublicHoliday`, for a `YYYY-MM-DD` string. Parses on local date parts,
 * never through the `Date` string constructor (which is UTC and can roll the
 * day depending on the browser/server timezone).
 */
export function isPublicHolidayISO(
  dateStr: string | null | undefined,
  jurisdiction: string = DEFAULT_JURISDICTION,
): boolean {
  if (!dateStr) return false;
  const key = dateStr.slice(0, 10);
  const year = Number(key.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return getYearIndex(year, jurisdiction).has(key);
}

/**
 * Sunday / public-holiday day-typing for a `YYYY-MM-DD` shift date, parsed on
 * LOCAL date parts. Single source of truth for the day-type flags EBA rules key
 * off (minimum engagement, penalty loadings) — callers should use this instead
 * of re-deriving `getDay() === 0` / `isHoliday()` themselves.
 */
export function getShiftDayType(
  dateStr: string | null | undefined,
  jurisdiction: string = DEFAULT_JURISDICTION,
): { isSunday: boolean; isPublicHoliday: boolean } {
  if (!dateStr) return { isSunday: false, isPublicHoliday: false };
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return { isSunday: false, isPublicHoliday: false };
  const localDate = new Date(year, month - 1, day);
  return {
    isSunday: localDate.getDay() === 0,
    isPublicHoliday: isPublicHoliday(localDate, jurisdiction),
  };
}
