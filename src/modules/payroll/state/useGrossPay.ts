/**
 * useGrossPay — thin container hook that fetches the gross-pay records for a
 * single pay period (one PeriodGrossPay per employee).
 *
 * Mirrors the repo's TanStack Query convention (see
 * src/modules/insights/hooks/*): `useQuery` with a tuple queryKey and an
 * `enabled` guard. Data fetching itself is delegated to the read module
 * `../data/grossPay.read.api` (built in a sibling lane):
 *
 *   getPeriodGrossPay(bounds, opts?): Promise<PeriodGrossPay[]>
 *
 * The hook stays presentation-agnostic and does no shaping beyond coalescing to
 * an empty array.
 */

import { useQuery } from '@tanstack/react-query';
import type { PeriodGrossPay } from '../model/gross-pay.types';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';

// Sibling data lane. Signature agreed as:
//   getPeriodGrossPay(bounds: PeriodBounds, opts?: GrossPayReadOptions): Promise<PeriodGrossPay[]>
import { getPeriodGrossPay } from '../data/grossPay.read.api';

/** Optional scoping/filter options passed straight through to the read module. */
export interface GrossPayReadOptions {
  /** Restrict to specific organizations / departments / sub-departments. */
  orgIds?: string[];
  deptIds?: string[];
  subDeptIds?: string[];
  /** Restrict to specific employees. */
  employeeIds?: string[];
}

export interface UseGrossPayArgs {
  bounds: PeriodBounds;
  options?: GrossPayReadOptions;
  /** Set false to hold the fetch (e.g. before bounds are known). Default true. */
  enabled?: boolean;
}

export function useGrossPay({ bounds, options, enabled = true }: UseGrossPayArgs) {
  return useQuery<PeriodGrossPay[]>({
    // Stable, serialisable key — TanStack structurally compares the tuple, so
    // the query refetches whenever bounds or options change.
    queryKey: [
      'gross_pay_period',
      bounds.periodId ?? null,
      bounds.periodStart,
      bounds.periodEnd,
      options ?? null,
    ],
    queryFn: async (): Promise<PeriodGrossPay[]> => {
      const mergedBounds = {
        ...bounds,
        orgIds: options?.orgIds,
        deptIds: options?.deptIds,
        subDeptIds: options?.subDeptIds,
      };
      const rows = await getPeriodGrossPay(mergedBounds, { approvedOnly: false });
      return rows ?? [];
    },
    // Only fire once we actually have period bounds.
    enabled: enabled && !!bounds?.periodStart && !!bounds?.periodEnd,
  });
}

export default useGrossPay;
