import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKED_BY_JURISDICTION } from '../holidays.generated';

/**
 * The browser and the database each keep public-holiday tables: the client
 * prices and checks shifts off `holidays.generated.ts`, while the SQL cost
 * engine, fairness ledger, day-typed shape rules and TOIL read
 * `public.public_holidays`. If they disagree, the estimate a manager sees and
 * the cost the database records disagree on the same shift.
 *
 * Nothing in the app writes `public_holidays`; its rows are captured from the
 * live database into `supabase/seeds/reference.sql` by
 * `scripts/db/reference-seed.sql`. So the seed is the database's table, and this
 * compares it with the client's, jurisdiction by jurisdiction and day by day,
 * over every year the database covers. Both sides hold each jurisdiction's OWN
 * days; a lookup adds the parents' (AU-QLD-BNE inherits AU-QLD).
 *
 * If this fails, fix whichever side is wrong — a new holiday needs both the
 * database rows and `npm run gen:holidays` — then regenerate the seed.
 */

// From a string, not `new URL(…)`: the jsdom environment replaces the global URL.
const SEED = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../supabase/seeds/reference.sql');

const ROW = /^INSERT INTO public\.public_holidays .*jsonb_populate_record\(NULL::public\.public_holidays, '(.*)'\) ON CONFLICT/;

function seededHolidays(): Array<{ date: string; jurisdiction: string }> {
    return readFileSync(SEED, 'utf8')
        .split('\n')
        .map((line) => ROW.exec(line))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => JSON.parse(m[1].replace(/''/g, "'")) as { holiday_date: string; jurisdiction: string })
        .map((r) => ({ date: r.holiday_date, jurisdiction: r.jurisdiction }));
}

/** The client's OWN days for one jurisdiction in one year (no parents). */
function clientOwnDays(jurisdiction: string, year: number): Set<string> {
    const packed = PACKED_BY_JURISDICTION[jurisdiction]?.[String(year)] ?? '';
    return new Set(packed.split(',').filter(Boolean)
        .map((e) => `${year}-${e.slice(0, 2)}-${e.slice(2, 4)}`));
}

describe('database public_holidays agrees with the client holiday tables', () => {
    const rows = seededHolidays();

    it('reads the seeded rows (guards against an empty parse)', () => {
        expect(rows.length).toBeGreaterThan(100);
    });

    it('holds days only for jurisdictions the client has a table for', () => {
        const known = new Set(Object.keys(PACKED_BY_JURISDICTION));
        const unknown = [...new Set(rows.map((r) => r.jurisdiction))].filter((j) => !known.has(j));
        expect(unknown).toEqual([]);
    });

    it('marks the same days, in both directions, in every jurisdiction the database holds', () => {
        const mismatches: string[] = [];
        for (const jurisdiction of new Set(rows.map((r) => r.jurisdiction))) {
            const own = rows.filter((r) => r.jurisdiction === jurisdiction);
            const seeded = new Set(own.map((r) => r.date));
            const years = own.map((r) => Number(r.date.slice(0, 4)));
            for (let year = Math.min(...years); year <= Math.max(...years); year++) {
                const client = clientOwnDays(jurisdiction, year);
                for (const d of client) if (!seeded.has(d)) mismatches.push(`${jurisdiction} ${d}: client only`);
                for (const d of seeded) if (d.startsWith(String(year)) && !client.has(d)) mismatches.push(`${jurisdiction} ${d}: database only`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
