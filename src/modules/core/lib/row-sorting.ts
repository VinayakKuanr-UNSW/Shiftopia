/**
 * Generic Sort By, the companion to `row-grouping`.
 *
 * The employee pages listed shifts in whatever order the query returned them —
 * usually date ascending, sometimes not, and never anything a person could
 * change. This gives them one vocabulary, the same way `RowGroupBy` did for
 * grouping, so the Sort control in the function bar means the same thing on
 * every page.
 *
 * Callers supply the same `GroupableFields` extractor they already pass to
 * `groupRows`, plus an optional start time for intra-day ordering.
 */

import type { GroupableFields } from './row-grouping';

export type RowSortBy = 'date' | 'startTime' | 'role' | 'group' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface RowSort {
  by: RowSortBy;
  direction: SortDirection;
}

export const DEFAULT_ROW_SORT: RowSort = { by: 'date', direction: 'asc' };

export const ROW_SORT_LABELS: Record<RowSortBy, string> = {
  date: 'Date',
  startTime: 'Start time',
  role: 'Role',
  group: 'Group',
  status: 'Status',
};

/**
 * Direction wording, per field.
 *
 * "Ascending" is meaningless to most people and actively misleading for dates —
 * ascending dates are *older* first, which reads as "descending" to anyone
 * thinking about recency. Each field gets words instead.
 */
export const SORT_DIRECTION_LABELS: Record<RowSortBy, Record<SortDirection, string>> = {
  date: { asc: 'Earliest first', desc: 'Latest first' },
  startTime: { asc: 'Earliest first', desc: 'Latest first' },
  role: { asc: 'A → Z', desc: 'Z → A' },
  group: { asc: 'A → Z', desc: 'Z → A' },
  status: { asc: 'A → Z', desc: 'Z → A' },
};

export interface SortableFields extends GroupableFields {
  /** "HH:mm" or "HH:mm:ss". Optional — falls back to date-only ordering. */
  startTime?: string;
}

function fieldValue(fields: SortableFields, by: RowSortBy): string {
  switch (by) {
    case 'date':
      return fields.date ?? '';
    case 'startTime':
      // Date first, then time — a bare time would interleave days.
      return `${fields.date ?? ''}T${(fields.startTime ?? '').slice(0, 5)}`;
    case 'role':
      return fields.role ?? '';
    case 'group':
      return fields.group ?? '';
    case 'status':
      return fields.status ?? '';
  }
}

/**
 * Sort a copy of `rows`. Never mutates the input — these arrays come straight
 * out of react-query caches, where an in-place sort corrupts the cache for
 * every other reader of the same key.
 */
export function sortRows<T>(
  rows: T[],
  sort: RowSort,
  extract: (row: T) => SortableFields,
): T[] {
  const dir = sort.direction === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const av = fieldValue(extract(a), sort.by);
    const bv = fieldValue(extract(b), sort.by);
    if (av === bv) {
      // Stable tie-break so equal keys do not shuffle between renders.
      const at = fieldValue(extract(a), 'startTime');
      const bt = fieldValue(extract(b), 'startTime');
      return at.localeCompare(bt);
    }
    // localeCompare with numeric handles "Level 2" before "Level 10"; ISO dates
    // and times compare correctly as plain strings.
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}
