import type { RowGroupBy, GroupBucket } from '@/modules/core/lib/row-grouping';
import { groupRows } from '@/modules/core/lib/row-grouping';
import type { GroupBySelectorOption } from '@/modules/core/ui/components/GroupBySelector';

export const SWAP_GROUP_BY_OPTIONS: GroupBySelectorOption[] = [
  { value: 'none',   label: 'Flat List' },
  { value: 'date',   label: 'By Date' },
  { value: 'status', label: 'By Status' },
  { value: 'role',   label: 'By Role' },
  { value: 'group',  label: 'By Venue Group' },
];

interface SwapGroupableItem {
  id: string;
  status: string;
  requestor: {
    date: string;
    roleName: string;
    groupType?: string;
    orgName?: string;
    deptName?: string;
    subGroupName?: string;
  };
  requestedAt?: string;
}

export function groupSwapRequests<T extends SwapGroupableItem>(
  requests: T[],
  groupBy: RowGroupBy = 'none',
): GroupBucket<T>[] {
  return groupRows(
    requests,
    groupBy,
    (r) => ({
      date: r.requestor.date || (r.requestedAt ? r.requestedAt.slice(0, 10) : ''),
      group: r.requestor.groupType || r.requestor.orgName || 'General',
      subGroup: r.requestor.subGroupName || r.requestor.deptName || 'General',
      role: r.requestor.roleName || 'Unspecified Role',
      status: r.status,
    }),
    (field, raw) => {
      if (field === 'status') {
        switch (raw) {
          case 'MANAGER_PENDING': return 'Pending Manager Review';
          case 'OPEN': return 'Open Marketplace';
          case 'APPROVED': return 'Approved';
          case 'REJECTED': return 'Rejected';
          case 'CANCELLED': return 'Cancelled';
          case 'EXPIRED': return 'Expired';
          default: return raw;
        }
      }
      return raw;
    },
  );
}
