import { format } from 'date-fns';
import { GROUP_OPTIONS, normalizeGroupKey } from '../ui/components/TimesheetFilterDrawer';
import type { TimesheetRow } from '../model/timesheet.types';
import type { GroupableFields } from '@/modules/core/lib/row-grouping';
import type { GroupBySelectorOption } from '@/modules/core/ui/components/GroupBySelector';

const GROUP_LABELS = new Map(GROUP_OPTIONS.map(g => [g.v, g.l]));

export function extractTimesheetGroupFields(row: TimesheetRow): GroupableFields {
    return {
        date: typeof row.date === 'string' ? row.date : format(row.date, 'yyyy-MM-dd'),
        // Normalized so shifts whose group resolved to a display name
        // ("Convention Centre") bucket together with ones that only had the
        // raw enum key ("convention_centre") — same underlying group.
        group: normalizeGroupKey(row.group),
        subGroup: row.subGroup,
        role: row.role,
        status: row.timesheetStatus,
    };
}

/** Group-type keys -> display names via GROUP_OPTIONS; status keys get title-cased. */
export function timesheetGroupLabelFor(field: 'group' | 'status', raw: string): string {
    if (field === 'group') return GROUP_LABELS.get(raw) ?? raw;
    return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export const TIMESHEET_GROUP_BY_OPTIONS: GroupBySelectorOption[] = [
    { value: 'date', label: 'Date' },
    { value: 'group', label: 'Group' },
    { value: 'subGroup', label: 'Sub-Group' },
    { value: 'role', label: 'Role' },
    { value: 'status', label: 'Timesheet Status' },
    { value: 'none', label: 'None' },
];
