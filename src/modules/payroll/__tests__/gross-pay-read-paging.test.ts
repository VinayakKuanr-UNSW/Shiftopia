import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A PostgREST response is capped (1,000 rows by default) and a capped response
 * looks exactly like a complete one. The reader used to issue one unpaged
 * query, so a period with more shifts than the cap was priced on a silent
 * subset. Pin that every row comes back, and that `.in()` lookups are chunked.
 */

const db = vi.hoisted(() => ({
  shifts: [] as any[],
  ranges: [] as Array<[number, number]>,
  inSizes: [] as number[],
}));

vi.mock('@/platform/supabase/client', () => {
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ['select', 'gte', 'lte', 'is', 'order', 'eq', 'not']) b[m] = () => b;
    b.in = (_col: string, ids: unknown[]) => {
      if (table !== 'shifts') db.inSizes.push(ids.length);
      return b;
    };
    b.range = (from: number, to: number) => {
      db.ranges.push([from, to]);
      return Promise.resolve({ data: db.shifts.slice(from, to + 1), error: null });
    };
    b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return b;
  };
  return { supabase: { from: builder, schema: () => ({ from: builder }) } };
});

import { fetchHydratedShiftRows } from '../data/grossPay.read.api';

const shift = (i: number) => ({
  id: `s${String(i).padStart(5, '0')}`,
  shift_date: '2026-07-06',
  start_time: '09:00:00',
  end_time: '17:00:00',
  lifecycle_status: 'Published',
  assigned_employee_id: `e${i}`,
  user_contract_id: null,
});

beforeEach(() => {
  db.ranges = [];
  db.inSizes = [];
});

describe('gross pay reader — paging past the API row cap', () => {
  it('returns every shift when the period holds more than one page', async () => {
    db.shifts = Array.from({ length: 1005 }, (_, i) => shift(i));
    const rows = await fetchHydratedShiftRows({ periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    expect(db.ranges).toEqual([[0, 999], [1000, 1999]]);
  });

  it('stops after one request when the first page is short', async () => {
    db.shifts = Array.from({ length: 3 }, (_, i) => shift(i));
    await fetchHydratedShiftRows({ periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    expect(db.ranges).toEqual([[0, 999]]);
  });

  it('chunks id lookups instead of one unbounded .in()', async () => {
    db.shifts = Array.from({ length: 1005 }, (_, i) => shift(i));
    await fetchHydratedShiftRows({ periodStart: '2026-07-06', periodEnd: '2026-07-12' });
    expect(db.inSizes.length).toBeGreaterThan(0);
    expect(Math.max(...db.inSizes)).toBeLessThanOrEqual(200);
  });
});
