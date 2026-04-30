import { supabase } from '@/platform/realtime/client';

// Rule types parsed from work_rules.rule_value JSONB

export interface SupervisoryRatioRule {
  subDepartmentId: string;
  ratio: number;              // 1 supervisor per N staff
  supervisorRoleId: string;
}

export interface MinimumStaffRule {
  subDepartmentId: string;
  roleId: string;
  minimumHeadcount: number;
}

/**
 * Fetch active supervisory ratio rules for the given sub-departments.
 * Reads from work_rules where rule_name = 'supervisory_ratio'.
 * Expected rule_value shape: { sub_department_id, ratio, supervisor_role_id }
 */
export async function fetchSupervisoryRatios(
  subDepartmentIds: string[],
): Promise<SupervisoryRatioRule[]> {
  if (subDepartmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('work_rules')
    .select('rule_value')
    .eq('rule_name', 'supervisory_ratio')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch supervisory ratios: ${error.message}`);
  if (!data) return [];

  const subDeptSet = new Set(subDepartmentIds);

  return data
    .map((row) => {
      const v = row.rule_value as Record<string, unknown>;
      return {
        subDepartmentId: v.sub_department_id as string,
        ratio: v.ratio as number,
        supervisorRoleId: v.supervisor_role_id as string,
      };
    })
    .filter((rule) => subDeptSet.has(rule.subDepartmentId));
}

/**
 * Fetch active minimum staff rules for the given sub-departments.
 * Reads from work_rules where rule_name = 'minimum_staff_per_function'.
 * Expected rule_value shape: { sub_department_id, role_id, minimum_headcount }
 */
export async function fetchMinimumStaffRules(
  subDepartmentIds: string[],
): Promise<MinimumStaffRule[]> {
  if (subDepartmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('work_rules')
    .select('rule_value')
    .eq('rule_name', 'minimum_staff_per_function')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch minimum staff rules: ${error.message}`);
  if (!data) return [];

  const subDeptSet = new Set(subDepartmentIds);

  return data
    .map((row) => {
      const v = row.rule_value as Record<string, unknown>;
      return {
        subDepartmentId: v.sub_department_id as string,
        roleId: v.role_id as string,
        minimumHeadcount: v.minimum_headcount as number,
      };
    })
    .filter((rule) => subDeptSet.has(rule.subDepartmentId));
}
