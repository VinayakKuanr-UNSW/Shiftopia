/**
 * useShiftPayLedger — the shift pay ledger for one period and scope (every
 * shift, priced three ways). Thin TanStack Query wrapper over
 * `getShiftPayLedger`, keyed like `useGrossPay`.
 */

import { useQuery } from '@tanstack/react-query';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';
import type { ShiftPayLedgerRow } from '../model/pay-ledger.types';
import { getShiftPayLedger } from '../data/shiftPayLedger';

export interface ShiftPayLedgerScope {
  orgIds?: string[];
  deptIds?: string[];
  subDeptIds?: string[];
}

export interface UseShiftPayLedgerArgs {
  bounds: PeriodBounds;
  scope?: ShiftPayLedgerScope;
  enabled?: boolean;
}

export function useShiftPayLedger({ bounds, scope, enabled = true }: UseShiftPayLedgerArgs) {
  return useQuery<ShiftPayLedgerRow[]>({
    queryKey: ['shift_pay_ledger', bounds.periodStart, bounds.periodEnd, scope ?? null],
    queryFn: () => getShiftPayLedger({
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      orgIds: scope?.orgIds,
      deptIds: scope?.deptIds,
      subDeptIds: scope?.subDeptIds,
    }),
    enabled: enabled && !!bounds.periodStart && !!bounds.periodEnd,
  });
}
