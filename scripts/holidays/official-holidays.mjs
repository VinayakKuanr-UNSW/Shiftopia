#!/usr/bin/env node
/**
 * official-holidays.mjs — the government's published public-holiday lists,
 * as the payload `public.reconcile_public_holidays(jsonb)` takes
 * (docs/architecture/multi-organization.md §13).
 *
 * Sources, all official and public:
 *   - data.gov.au "Australian Public Holidays Dates Machine Readable Dataset"
 *     (Department of the Prime Minister and Cabinet): one CSV for 2021–2025.
 *     Marked INACTIVE — no year after 2025 will be published — so it only
 *     covers the past.
 *   - NSW: nsw.gov.au/about-nsw/public-holidays (the current and next year).
 *   - Queensland: qld.gov.au/recreation/travel/holidays/public (four years).
 * The state pages are HTML tables; parsing is strict (every cell must be a
 * date whose weekday matches, or "Not applicable"), so a redesigned page fails
 * the run instead of feeding the database a wrong list.
 *
 * Kept to what `public_holidays` holds — each jurisdiction's OWN whole-day
 * public holidays:
 *   - NSW "Bank Holiday" is not a declared public holiday (the page says so).
 *   - Queensland's Christmas Eve holiday is 6pm–midnight only (§3 H2).
 *   - "Royal Queensland Show (Brisbane area only)" is the Ekka: AU-QLD-BNE.
 *   - National days appear on every state; AU holds none.
 * A later source replaces an earlier one for the same jurisdiction-year.
 *
 * Usage:
 *   node scripts/holidays/official-holidays.mjs > payload.json
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SOURCES = {
  dataGovAu: 'https://data.gov.au/data/dataset/b1bc6077-dadd-4f61-9f8c-002ab2cdff10/resource/33673aca-0857-42e5-b8f0-9981b4755686/download/australian-public-holidays-combined-2021-2025.csv',
  nsw: 'https://www.nsw.gov.au/about-nsw/public-holidays',
  qld: 'https://www.qld.gov.au/recreation/travel/holidays/public',
};

/** Fewer whole-day holidays than this in a state-year means the page was misread. */
const MIN_STATE_HOLIDAYS = 10;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DATE_IN_TEXT = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/gi;

const isExcluded = (name) => /^bank holiday$/i.test(name) || /christmas eve/i.test(name);
const isEkka = (name) => /royal queensland show/i.test(name);

// ── small text helpers ───────────────────────────────────────────────────────

const ENTITIES = { nbsp: ' ', amp: '&', rsquo: "'", lsquo: "'", quot: '"', apos: "'", ndash: '–', mdash: '—', lt: '<', gt: '>' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Normalize punctuation and UTF-8-as-Latin-1 apostrophe mojibake (data.gov.au CSV). */
function cleanText(s) {
  return s.replace(/â€™|[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Visible text of an HTML fragment; footnote markers (<sup>) dropped. */
function cellText(html) {
  return cleanText(decodeEntities(html.replace(/<sup\b[^>]*>.*?<\/sup>/gis, '').replace(/<[^>]+>/g, ' ')));
}

/** A holiday cell's first paragraph (the QLD Ekka cell has a second, a link). */
function nameText(html) {
  const p = /<p\b[^>]*>(.*?)<\/p>/is.exec(html);
  return cellText(p ? p[1] : html);
}

function isoDate(year, monthName, day, weekdayName) {
  const month = MONTHS.indexOf(monthName.toLowerCase());
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) throw new Error(`no such date: ${day} ${monthName} ${year}`);
  if (WEEKDAYS[d.getUTCDay()] !== weekdayName.toLowerCase()) {
    throw new Error(`${day} ${monthName} ${year} is not a ${weekdayName}`);
  }
  return d.toISOString().slice(0, 10);
}

/** Every date in a cell ("Saturday 1 January and Monday 3 January"); strict. */
function cellDates(text, year) {
  if (/^not applicable$/i.test(text)) return [];
  const dates = [];
  const rest = text.replace(DATE_IN_TEXT, (_, weekday, day, month, y) => {
    if (y && Number(y) !== year) throw new Error(`"${text}" is not in ${year}`);
    dates.push(isoDate(year, month, Number(day), weekday));
    return ' ';
  });
  if (dates.length === 0 || rest.replace(/\band\b/gi, '').trim() !== '') {
    throw new Error(`unreadable date cell "${text}"`);
  }
  return dates;
}

/** The holiday table: header "Holiday" then one column per year. */
function yearTable(html, label) {
  for (const table of html.match(/<table\b.*?<\/table>/gis) ?? []) {
    const rows = (table.match(/<tr\b.*?<\/tr>/gis) ?? [])
      .map((tr) => (tr.match(/<t[hd]\b.*?<\/t[hd]>/gis) ?? []).map((c) => c.replace(/^<t[hd]\b[^>]*>|<\/t[hd]>$/gi, '')));
    const [header, ...body] = rows;
    if (!header || cellText(header[0]) !== 'Holiday') continue;
    const years = header.slice(1).map((c) => Number(cellText(c)));
    if (years.length === 0 || !years.every((y) => y >= 2000 && y <= 2100)) continue;
    return { years, body };
  }
  throw new Error(`${label}: no holiday table (header "Holiday", then years) on the page`);
}

// ── entries ──────────────────────────────────────────────────────────────────

/** @typedef {{ jurisdiction: string, year: number, source_url: string, holidays: Array<{ date: string, name: string }> }} Entry */

function entriesFrom(rows, stateCode, sourceUrl, years) {
  /** @type {Map<string, Entry>} */
  const out = new Map();
  const entry = (jurisdiction, year) => {
    const key = `${jurisdiction} ${year}`;
    if (!out.has(key)) out.set(key, { jurisdiction, year, source_url: sourceUrl, holidays: [] });
    return out.get(key);
  };
  // Every year the source covers is covered for the state and, in Queensland,
  // for Brisbane too (an Ekka missing from a covered year is a finding).
  for (const year of years) {
    entry(stateCode, year);
    if (stateCode === 'AU-QLD') entry('AU-QLD-BNE', year);
  }
  for (const { date, name } of rows) {
    if (isExcluded(name)) continue;
    const jurisdiction = stateCode === 'AU-QLD' && isEkka(name) ? 'AU-QLD-BNE' : stateCode;
    entry(jurisdiction, Number(date.slice(0, 4))).holidays.push({ date, name });
  }
  for (const e of out.values()) {
    e.holidays.sort((a, b) => a.date.localeCompare(b.date));
    if (e.jurisdiction !== 'AU-QLD-BNE' && e.holidays.length < MIN_STATE_HOLIDAYS) {
      throw new Error(`${e.jurisdiction} ${e.year}: only ${e.holidays.length} holidays read from ${sourceUrl}`);
    }
  }
  return [...out.values()];
}

/** Minimal RFC 4180 reader (quoted fields may hold commas, quotes and newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** data.gov.au CSV → entries for NSW and Queensland. */
export function parseDataGovAuCsv(text, sourceUrl = SOURCES.dataGovAu) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const col = (name) => {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name);
    if (i < 0) throw new Error(`data.gov.au CSV: no "${name}" column`);
    return i;
  };
  const [iDate, iName, iJur] = [col('date'), col('holiday name'), col('jurisdiction')];
  const out = [];
  for (const [state, code] of [['nsw', 'AU-NSW'], ['qld', 'AU-QLD']]) {
    const mine = rows.filter((r) => r[iJur].trim().toLowerCase() === state).map((r) => {
      const d = r[iDate].trim();
      if (!/^\d{8}$/.test(d)) throw new Error(`data.gov.au CSV: bad date "${d}"`);
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: cleanText(r[iName]) };
    });
    const years = [...new Set(mine.map((r) => Number(r.date.slice(0, 4))))];
    out.push(...entriesFrom(mine, code, sourceUrl, years));
  }
  return out;
}

/** nsw.gov.au table: dates carry their year; "Additional Day" rows follow their holiday. */
export function parseNswPage(html, sourceUrl = SOURCES.nsw) {
  const { years, body } = yearTable(html, 'NSW');
  const rows = [];
  let previous = null;
  for (const cells of body) {
    let name = cellText(cells[0]);
    if (/^additional day$/i.test(name)) {
      if (!previous) throw new Error('NSW: "Additional Day" with no holiday before it');
      name = `${previous} (additional day)`;
    } else previous = name;
    years.forEach((year, i) => {
      for (const date of cellDates(cellText(cells[i + 1] ?? ''), year)) rows.push({ date, name });
    });
  }
  return entriesFrom(rows, 'AU-NSW', sourceUrl, years);
}

/** qld.gov.au table: dates without a year; a cell may hold two ("… and Monday 3 January"). */
export function parseQldPage(html, sourceUrl = SOURCES.qld) {
  const { years, body } = yearTable(html, 'QLD');
  const rows = [];
  for (const cells of body) {
    const name = nameText(cells[0]);
    years.forEach((year, i) => {
      for (const date of cellDates(cellText(cells[i + 1] ?? ''), year)) rows.push({ date, name });
    });
  }
  return entriesFrom(rows, 'AU-QLD', sourceUrl, years);
}

/** Merge per-source entries; later sources win per jurisdiction-year. */
export function buildPayload(...entryLists) {
  const byKey = new Map();
  for (const list of entryLists) for (const e of list) byKey.set(`${e.jurisdiction} ${e.year}`, e);
  const jurisdictions = [...byKey.values()]
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.year - b.year);
  return { jurisdictions };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; public-holiday-check)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [csv, nsw, qld] = await Promise.all([SOURCES.dataGovAu, SOURCES.nsw, SOURCES.qld].map(fetchText));
  const payload = buildPayload(parseDataGovAuCsv(csv), parseNswPage(nsw), parseQldPage(qld));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  for (const e of payload.jurisdictions) console.error(`${e.jurisdiction} ${e.year}: ${e.holidays.length} (${e.source_url})`);
}
