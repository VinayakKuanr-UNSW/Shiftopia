import { format, parseISO, isToday } from 'date-fns';

/**
 * Generic Group By used across My Attendance and Timesheets.
 * 'status' means different things per page (attendance vs timesheet status) —
 * callers supply that meaning via their `extract` function.
 */
export type RowGroupBy = 'date' | 'group' | 'subGroup' | 'role' | 'status' | 'none';

export interface GroupBucket<T> {
    key: string;
    label: string;
    items: T[];
}

export interface GroupableFields {
    date: string;
    group: string;
    subGroup: string;
    role: string;
    status: string;
}

function dateLabel(iso: string): string {
    try {
        const d = parseISO(iso);
        return isToday(d) ? 'Today' : format(d, 'EEEE, d MMMM');
    } catch { return iso; }
}

/** True when a 'date' bucket's key is today — callers use this to emphasize the header. */
export function isTodayBucketKey(key: string): boolean {
    try { return isToday(parseISO(key)); }
    catch { return false; }
}

/**
 * Bucket `rows` by the chosen dimension. Buckets preserve first-seen order
 * (matches the prior date-only grouping behavior) — pre-sort `rows` if a
 * specific bucket order is required.
 *
 * `labelFor` lets callers prettify a raw group/status key (e.g. venue enum
 * keys -> display names) — falls back to the raw value when omitted.
 */
export function groupRows<T>(
    rows: T[],
    groupBy: RowGroupBy,
    extract: (row: T) => GroupableFields,
    labelFor?: (field: 'group' | 'status', raw: string) => string,
): GroupBucket<T>[] {
    if (groupBy === 'none' || rows.length === 0) {
        return [{ key: '__all__', label: '', items: rows }];
    }

    const buckets = new Map<string, GroupBucket<T>>();

    for (const row of rows) {
        const fields = extract(row);
        let key: string;
        let label: string;

        switch (groupBy) {
            case 'date':
                key = fields.date;
                label = dateLabel(fields.date);
                break;
            case 'group':
                key = fields.group || '(none)';
                label = fields.group ? (labelFor?.('group', fields.group) ?? fields.group) : 'No Group';
                break;
            case 'subGroup':
                key = fields.subGroup || '(none)';
                label = fields.subGroup || 'No Sub-Group';
                break;
            case 'role':
                key = fields.role || '(none)';
                label = fields.role || 'No Role';
                break;
            case 'status':
                key = fields.status || '(none)';
                label = fields.status ? (labelFor?.('status', fields.status) ?? fields.status) : 'Unknown';
                break;
        }

        if (!buckets.has(key)) buckets.set(key, { key, label, items: [] });
        buckets.get(key)!.items.push(row);
    }

    return Array.from(buckets.values());
}
