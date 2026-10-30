/**
 * What the Labour cost tab needs beyond the ledger: department and
 * sub-department names, and department budgets pro-rated to the period.
 * `department_budgets` is readable by managers and above (RLS
 * dept_budgets_manager_all) — the same audience the planner footer had.
 */

import { supabase } from '@/platform/supabase/client';
import { prorateBudgets, type DepartmentBudgetRow } from '../domain/labourCost';

export interface LabourCostContext {
  departmentNames: Map<string, string>;
  subDepartmentNames: Map<string, string>;
  budgets: Map<string, number>;
}

export interface LabourCostContextArgs {
  periodStart: string;
  periodEnd: string;
  /** Departments to budget and name — the scope's, plus any the ledger touches. */
  departmentIds: readonly string[];
  subDepartmentIds: readonly string[];
}

async function namesById(table: 'departments' | 'sub_departments', ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from(table).select('id, name').in('id', [...ids]);
  if (error) throw error;
  for (const r of (data ?? []) as { id: string; name: string }[]) out.set(r.id, r.name);
  return out;
}

export async function getLabourCostContext(args: LabourCostContextArgs): Promise<LabourCostContext> {
  const budgetQuery = args.departmentIds.length === 0
    ? Promise.resolve({ data: [] as DepartmentBudgetRow[], error: null })
    : supabase
        .from('department_budgets')
        .select('dept_id, period_start, period_end, budgeted_cost')
        .in('dept_id', [...args.departmentIds])
        .lte('period_start', args.periodEnd)
        .gte('period_end', args.periodStart);

  const [budgetRes, departmentNames, subDepartmentNames] = await Promise.all([
    budgetQuery,
    namesById('departments', args.departmentIds),
    namesById('sub_departments', args.subDepartmentIds),
  ]);
  if (budgetRes.error) throw budgetRes.error;

  return {
    departmentNames,
    subDepartmentNames,
    budgets: prorateBudgets((budgetRes.data ?? []) as DepartmentBudgetRow[], args.periodStart, args.periodEnd),
  };
}
