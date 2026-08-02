import { GROUP_OPTIONS, normalizeGroupKey } from '@/modules/timesheets/ui/components/TimesheetFilterDrawer';
import type { Shift } from './shift.entity';
import type { GroupableFields } from '@/modules/core/lib/row-grouping';
import type { GroupBySelectorOption } from '@/modules/core/ui/components/GroupBySelector';

const GROUP_LABELS = new Map(GROUP_OPTIONS.map(g => [g.v, g.l]));

/** Attendance-status vocabulary — shared between the status tabs and Group By labels. */
export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
    all: 'All',
    checked_in: 'Completed',
    late: 'Late In',
    no_show: 'No Show',
    unknown: 'No Record',
};

export function extractAttendanceGroupFields(shift: Shift): GroupableFields {
    return {
        date: shift.shift_date,
        // Normalized so shifts whose group resolved to a display name
        // ("Convention Centre") bucket together with ones that only had the
        // raw enum key ("convention_centre") — same underlying group.
        group: normalizeGroupKey(shift.roster_subgroup?.roster_group?.name || shift.group_type || ''),
        subGroup: shift.sub_group_name || '',
        role: shift.roles?.name || '',
        status: shift.attendance_status ?? 'unknown',
    };
}

export function attendanceGroupLabelFor(field: 'group' | 'status', raw: string): string {
    if (field === 'group') return GROUP_LABELS.get(raw) ?? raw;
    return ATTENDANCE_STATUS_LABELS[raw] ?? raw;
}

export const ATTENDANCE_GROUP_BY_OPTIONS: GroupBySelectorOption[] = [
    { value: 'date', label: 'Date' },
    { value: 'group', label: 'Group' },
    { value: 'subGroup', label: 'Sub-Group' },
    { value: 'role', label: 'Role' },
    { value: 'status', label: 'Attendance Status' },
    { value: 'none', label: 'None' },
];
