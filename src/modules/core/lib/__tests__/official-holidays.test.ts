import { describe, it, expect } from 'vitest';
import {
  parseDataGovAuCsv,
  parseNswPage,
  parseQldPage,
  buildPayload,
} from '../../../../../scripts/holidays/official-holidays.mjs';

const CSV_SAMPLE = [
  'ID,Date,Holiday Name,Information,More Information,Jurisdiction',
  // 10 NSW holidays + Bank Holiday (excluded)
  '1,20240101,New Year\'s Day,info,url,nsw',
  '2,20240126,Australia Day,info,url,nsw',
  '3,20240329,Good Friday,info,url,nsw',
  '4,20240330,Easter Saturday,info,url,nsw',
  '5,20240331,Easter Sunday,info,url,nsw',
  '6,20240401,Easter Monday,info,url,nsw',
  '7,20240425,Anzac Day,info,url,nsw',
  '8,20240610,King\'s Birthday,info,url,nsw',
  '9,20240805,Bank Holiday,not a declared PH,url,nsw',
  '10,20241007,Labour Day,info,url,nsw',
  '11,20241225,Christmas Day,info,url,nsw',
  '12,20241226,Boxing Day,info,url,nsw',
  // 10 QLD holidays + Christmas Eve (excluded) + Ekka (routed to AU-QLD-BNE) + mojibake apostrophe
  '21,20240101,New Year\'s Day,info,url,qld',
  '22,20240126,Australia Day,info,url,qld',
  '23,20240329,Good Friday,info,url,qld',
  '24,20240330,Easter Saturday,info,url,qld',
  '25,20240331,Easter Sunday,info,url,qld',
  '26,20240401,Easter Monday,info,url,qld',
  '27,20240425,Anzac Day,info,url,qld',
  '28,20240506,Labour Day,info,url,qld',
  '29,20240814,Royal Queensland Show (Brisbane only),ekka,url,qld',
  '30,20241007,Kingâ€™s Birthday,mojibake,url,qld',
  '31,20241224,Christmas Eve,part-day,url,qld',
  '32,20241225,Christmas Day,info,url,qld',
  '33,20241226,Boxing Day,info,url,qld',
].join('\n');

const NSW_HTML_SAMPLE = `
<table>
  <tr><th>Holiday</th><th>2026</th></tr>
  <tr><td>New Year&rsquo;s Day</td><td>Thursday 1 January 2026</td></tr>
  <tr><td>Australia Day</td><td>Monday 26 January 2026</td></tr>
  <tr><td>Good Friday</td><td>Friday 3 April 2026</td></tr>
  <tr><td>Easter Saturday</td><td>Saturday 4 April 2026</td></tr>
  <tr><td>Easter Sunday</td><td>Sunday 5 April 2026</td></tr>
  <tr><td>Easter Monday</td><td>Monday 6 April 2026</td></tr>
  <tr><td>Anzac Day</td><td>Saturday 25 April 2026</td></tr>
  <tr><td>Additional Day</td><td>Monday 27 April 2026</td></tr>
  <tr><td>King&rsquo;s Birthday</td><td>Monday 8 June 2026</td></tr>
  <tr><td>Bank Holiday<sup>1</sup></td><td>Monday 3 August 2026</td></tr>
  <tr><td>Labour Day</td><td>Monday 5 October 2026</td></tr>
  <tr><td>Christmas Day</td><td>Friday 25 December 2026</td></tr>
  <tr><td>Boxing Day</td><td>Saturday 26 December 2026</td></tr>
  <tr><td>Additional Day</td><td>Monday 28 December 2026</td></tr>
</table>`;

const QLD_HTML_SAMPLE = `
<table>
  <tr><th>Holiday</th><th>2026</th></tr>
  <tr><td><p>New Year&rsquo;s Day</p></td><td>Thursday 1 January</td></tr>
  <tr><td><p>Australia Day</p></td><td>Monday 26 January</td></tr>
  <tr><td><p>Good Friday</p></td><td>Friday 3 April</td></tr>
  <tr><td><p>The day after Good Friday</p></td><td>Saturday 4 April</td></tr>
  <tr><td><p>Easter Sunday</p></td><td>Sunday 5 April</td></tr>
  <tr><td><p>Easter Monday</p></td><td>Monday 6 April</td></tr>
  <tr><td><p>Anzac Day</p></td><td>Saturday 25 April</td></tr>
  <tr><td><p>Labour Day</p></td><td>Monday 4 May</td></tr>
  <tr><td><p>Royal Queensland Show (Brisbane area only)</p><p><a href="/shows">Regional shows</a></p></td><td>Wednesday 12 August</td></tr>
  <tr><td><p>King&rsquo;s Birthday</p></td><td>Monday 5 October</td></tr>
  <tr><td><p>Christmas Eve (6pm to midnight)</p></td><td>Thursday 24 December</td></tr>
  <tr><td><p>Christmas Day</p></td><td>Friday 25 December</td></tr>
  <tr><td><p>Boxing Day</p></td><td>Saturday 26 December and Monday 28 December</td></tr>
</table>`;

interface OfficialEntry {
  jurisdiction: string;
  year: number;
  source_url: string;
  holidays: Array<{ date: string; name: string }>;
}

describe('official-holidays parser', () => {
  it('parses data.gov.au CSV: excludes Bank Holiday & Christmas Eve, routes Ekka to AU-QLD-BNE, normalizes mojibake', () => {
    const entries = parseDataGovAuCsv(CSV_SAMPLE, 'https://data.gov.au/test.csv') as OfficialEntry[];
    const byKey = new Map<string, OfficialEntry>(entries.map((e) => [`${e.jurisdiction} ${e.year}`, e]));

    const nsw = byKey.get('AU-NSW 2024')!;
    expect(nsw.holidays).toHaveLength(11);
    expect(nsw.holidays.some((h) => /bank holiday/i.test(h.name))).toBe(false);

    const qld = byKey.get('AU-QLD 2024')!;
    expect(qld.holidays).toHaveLength(11);
    expect(qld.holidays.some((h) => /christmas eve/i.test(h.name))).toBe(false);
    expect(qld.holidays.find((h) => h.date === '2024-10-07')?.name).toBe("King's Birthday");

    const bne = byKey.get('AU-QLD-BNE 2024')!;
    expect(bne.holidays).toEqual([
      { date: '2024-08-14', name: 'Royal Queensland Show (Brisbane only)' },
    ]);
  });

  it('parses NSW HTML table: chains Additional Day names, strips footnotes, excludes Bank Holiday', () => {
    const [nsw] = parseNswPage(NSW_HTML_SAMPLE, 'https://www.nsw.gov.au/test');
    expect(nsw.jurisdiction).toBe('AU-NSW');
    expect(nsw.year).toBe(2026);
    expect(nsw.holidays).toHaveLength(13);
    expect(nsw.holidays.find((h) => h.date === '2026-04-27')?.name).toBe('Anzac Day (additional day)');
    expect(nsw.holidays.find((h) => h.date === '2026-12-28')?.name).toBe('Boxing Day (additional day)');
    expect(nsw.holidays.some((h) => /bank holiday/i.test(h.name))).toBe(false);
  });

  it('parses QLD HTML table: splits multi-date cells, routes Ekka to AU-QLD-BNE, excludes Christmas Eve', () => {
    const entries = parseQldPage(QLD_HTML_SAMPLE, 'https://www.qld.gov.au/test');
    const qld = entries.find((e) => e.jurisdiction === 'AU-QLD')!;
    const bne = entries.find((e) => e.jurisdiction === 'AU-QLD-BNE')!;

    expect(qld.holidays).toHaveLength(12);
    expect(qld.holidays.filter((h) => h.name === 'Boxing Day').map((h) => h.date)).toEqual([
      '2026-12-26',
      '2026-12-28',
    ]);
    expect(qld.holidays.some((h) => /christmas eve/i.test(h.name))).toBe(false);
    expect(bne.holidays).toEqual([
      { date: '2026-08-12', name: 'Royal Queensland Show (Brisbane area only)' },
    ]);
  });

  it('fails strictly on weekday mismatch or redesigned HTML without a Holiday table', () => {
    const badWeekday = NSW_HTML_SAMPLE.replace('Thursday 1 January 2026', 'Friday 1 January 2026');
    expect(() => parseNswPage(badWeekday)).toThrow(/not a Friday/i);
    expect(() => parseNswPage('<table><tr><th>Date</th></tr></table>')).toThrow(/no holiday table/i);
  });

  it('buildPayload lets later sources override earlier ones per jurisdiction-year in sorted order', () => {
    const older = [{ jurisdiction: 'AU-NSW', year: 2025, source_url: 'https://old', holidays: [] }];
    const newer = [{ jurisdiction: 'AU-NSW', year: 2025, source_url: 'https://new', holidays: [{ date: '2025-01-01', name: "New Year's Day" }] }];
    const payload = buildPayload(older, newer);
    expect(payload.jurisdictions).toHaveLength(1);
    expect(payload.jurisdictions[0].source_url).toBe('https://new');
  });
});
