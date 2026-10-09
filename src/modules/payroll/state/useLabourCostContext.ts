/**
 * useLabourCostContext — names and pro-rated budgets for the departments and
 * sub-departments a ledger touches (plus the scope's own departments, so a
 * budgeted department with no shifts still shows its budget).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PeriodBounds } from '../domain/aggregatePeriodGrossPay';
import type { ShiftPayLedgerRow } from '../model/pay-ledger.types';
import { getLabourCostContext, type LabourCostContext } from '../data/labourCost.read.api';

function sortedUnique(ids: Iterable<string | null | undefined>): string[] {
  return [...new Set([...ids].filter((id): id is string => !!id))].sort();
}

export function useLabourCostContext({
  rows,
  bounds,
  scopeDepartmentIds,
  enabled = true,
}: {
  rows: readonly ShiftPayLedgerRow[];
  bounds: PeriodBounds;
  scopeDepartmentIds?: readonly string[];
  enabled?: boolean;
}) {
  const departmentIds = useMemo(
    () => sortedUnique([...rows.map((r) => r.departmentId), ...(scopeDepartmentIds ?? [])]),
    [rows, scopeDepartmentIds],
  );
  const subDepartmentIds = useMemo(() => sortedUnique(rows.map((r) => r.subDepartmentId)), [rows]);

  return useQuery<LabourCostContext>({
    queryKey: ['labour_cost_context', bounds.periodStart, bounds.periodEnd, departmentIds, subDepartmentIds],
    queryFn: () => getLabourCostContext({
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
      departmentIds,
      subDepartmentIds,
    }),
    enabled: enabled && !!bounds.periodStart && !!bounds.periodEnd,
  });
}
