// src/modules/planning/bidding/ui/views/OpenBidsView/open-bids-grouping.ts

import type { RowGroupBy, GroupBucket } from '@/modules/core/lib/row-grouping';
import { groupRows } from '@/modules/core/lib/row-grouping';
import type { GroupBySelectorOption } from '@/modules/core/ui/components/GroupBySelector';
import type { ManagerBidShift } from './types';

export const OPEN_BIDS_GROUP_BY_OPTIONS: GroupBySelectorOption[] = [
  { value: 'none',     label: 'Flat List' },
  { value: 'date',     label: 'By Date' },
  { value: 'subGroup', label: 'By Sub-Dept' },
  { value: 'role',     label: 'By Role' },
  { value: 'group',    label: 'By Venue Group' },
];

export function groupOpenBids(
  shifts: ManagerBidShift[],
  groupBy: RowGroupBy = 'none',
): GroupBucket<ManagerBidShift>[] {
  return groupRows(
    shifts,
    groupBy,
    (s) => ({
      date: s.date,
      group: s.groupType || s.organization || 'Default Group',
      subGroup: s.subDepartment && s.subDepartment !== s.department
        ? `${s.department} · ${s.subDepartment}`
        : s.department || 'General',
      role: s.role || 'Unspecified Role',
      status: s.toggle,
    }),
  );
}
