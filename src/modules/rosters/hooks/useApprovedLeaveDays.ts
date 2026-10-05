/**
 * Approved leave, by employee and date, for the People mode grid.
 *
 * Moved over from the Office page (handover 2026-10-04, Phase 3): the grid a
 * full-time employee's week used to live on showed a leave card on every
 * approved-leave day, and the Rosters page now has to. It is not full-time
 * specific — an approved leave day is closed to rostering for anyone.
 *
 * APPROVED ONLY. `loadLeaveDays` returns pending requests too, because the
 * Office ledger needed them; a request nobody has actioned must not take a day
 * off the grid, so they are dropped here.
 *
 * Keyed with a `Map`, never a plain object: an object lookup returns
 * `Object.prototype` members for keys like `constructor` (see MyRoster's
 * prototype-pollution fix).
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

import { loadLeaveDays } from '@/modules/office/api/office.loaders';
import type { RawLeaveDay } from '@/modules/office/domain/types';

export const approvedLeaveKeys = {
    all: ['leave', 'approved-days'] as const,
    range: (employeeIds: readonly string[], from: string, to: string) =>
        ['leave', 'approved-days', [...employeeIds].sort().join(','), from, to] as const,
};

/** Index leave days to employee → date → the approved day (first one wins). */
export function indexApprovedLeaveDays(
    byEmployee: ReadonlyMap<string, readonly RawLeaveDay[]>,
): Map<string, Map<string, RawLeaveDay>> {
    const out = new Map<string, Map<string, RawLeaveDay>>();
    for (const [employeeId, days] of byEmployee) {
        for (const day of days) {
            if (day.status !== 'approved') continue;
            let dates = out.get(employeeId);
            if (!dates) out.set(employeeId, (dates = new Map()));
            if (!dates.has(day.date)) dates.set(day.date, day);
        }
    }
    return out;
}

export function useApprovedLeaveDays(employeeIds: readonly string[], dates: readonly Date[]) {
    const from = dates.length > 0 ? format(dates[0], 'yyyy-MM-dd') : '';
    const to = dates.length > 0 ? format(dates[dates.length - 1], 'yyyy-MM-dd') : '';

    const { data } = useQuery({
        queryKey: approvedLeaveKeys.range(employeeIds, from, to),
        enabled: employeeIds.length > 0 && Boolean(from && to),
        staleTime: 60_000,
        queryFn: () => loadLeaveDays(employeeIds, from, to),
    });

    const index = useMemo(() => indexApprovedLeaveDays(data ?? new Map()), [data]);

    const getLeave = useCallback(
        (employeeId: string, dateKey: string): RawLeaveDay | undefined => index.get(employeeId)?.get(dateKey),
        [index],
    );

    return { getLeave };
}
