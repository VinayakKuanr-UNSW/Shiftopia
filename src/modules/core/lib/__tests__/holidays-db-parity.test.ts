import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPublicHolidayISO } from '../holidays';

/**
 * The browser and the database each keep a public-holiday table: the client
 * prices and checks shifts off `holidays.generated.ts`, while the SQL cost
 * engine, fairness ledger, day-typed shape rules and TOIL read
 * `public.public_holidays`. If they disagree, the estimate a manager sees and
 * the cost the database records disagree on the same shift.
 *
 * Nothing in the app writes `public_holidays`; its rows arrive by migration and
 * are captured from the live database into `supabase/seeds/reference.sql` by
 * `scripts/db/reference-seed.sql`. So the seed is the database's table, and this
 * compares it, day by day, with the client's over every year the database covers.
 *
 * If this fails, fix whichever side is wrong — a new NSW holiday needs both a
 * migration and `npm run gen:holidays` — then regenerate the seed.
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

describe('database public_holidays agrees with the client holiday table', () => {
    const rows = seededHolidays();

    it('reads the seeded rows (guards against an empty parse)', () => {
        expect(rows.length).toBeGreaterThan(100);
    });

    it('holds NSW only, the one jurisdiction the client table covers', () => {
        expect([...new Set(rows.map((r) => r.jurisdiction))]).toEqual(['AU-NSW']);
    });

    it('marks the same days as public holidays, in both directions', () => {
        const seeded = new Set(rows.map((r) => r.date));
        const years = rows.map((r) => Number(r.date.slice(0, 4)));
        const mismatches: string[] = [];

        for (let year = Math.min(...years); year <= Math.max(...years); year++) {
            for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
                const iso = d.toISOString().slice(0, 10);
                const inDb = seeded.has(iso);
                if (inDb !== isPublicHolidayISO(iso)) mismatches.push(`${iso}: database ${inDb}, client ${!inDb}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
