import { describe, expect, it } from 'vitest';
import { sortRows, DEFAULT_ROW_SORT, type RowSort } from '../row-sorting';

interface Row {
  id: string;
  date: string;
  startTime: string;
  role: string;
  group: string;
  status: string;
}

const ROWS: Row[] = [
  { id: 'b', date: '2026-08-20', startTime: '14:00', role: 'Team Leader', group: 'Theatre', status: 'late' },
  { id: 'a', date: '2026-08-19', startTime: '09:00', role: 'Attendant', group: 'Convention', status: 'checked_in' },
  { id: 'c', date: '2026-08-20', startTime: '06:30', role: 'Supervisor', group: 'Exhibition', status: 'no_show' },
];

const extract = (r: Row) => ({
  date: r.date,
  startTime: r.startTime,
  role: r.role,
  group: r.group,
  status: r.status,
  subGroup: '',
});

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('sortRows', () => {
  it('orders by date, earliest first, by default', () => {
    expect(ids(sortRows(ROWS, DEFAULT_ROW_SORT, extract))).toEqual(['a', 'c', 'b']);
  });

  it('reverses on desc', () => {
    const sort: RowSort = { by: 'date', direction: 'desc' };
    // 'b' and 'c' share a date, so the start-time tie-break decides between
    // them and keeps the order stable across renders.
    expect(ids(sortRows(ROWS, sort, extract))).toEqual(['c', 'b', 'a']);
  });

  it('orders by start time within the day, not across days', () => {
    // A bare time would put the 06:30 on the 20th ahead of the 09:00 on the
    // 19th, interleaving two different days.
    const sort: RowSort = { by: 'startTime', direction: 'asc' };
    expect(ids(sortRows(ROWS, sort, extract))).toEqual(['a', 'c', 'b']);
  });

  it('sorts text fields case-insensitively and numerically', () => {
    const rows: Row[] = [
      { ...ROWS[0], id: '10', role: 'Level 10' },
      { ...ROWS[0], id: '2', role: 'level 2' },
    ];
    expect(ids(sortRows(rows, { by: 'role', direction: 'asc' }, extract))).toEqual(['2', '10']);
  });

  it('never mutates the input', () => {
    // These arrays come out of react-query caches, where an in-place sort
    // corrupts the cache for every other reader of the same key.
    const original = [...ROWS];
    sortRows(ROWS, { by: 'role', direction: 'desc' }, extract);
    expect(ROWS).toEqual(original);
  });
});
