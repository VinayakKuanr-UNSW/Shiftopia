/**
 * Fairness Utilities
 * 
 * Measures equitable distribution of work.
 * Improved from capstone to use Contracted Hours as the baseline.
 */

export interface EmployeeFairness {
  employeeId: string;
  contractedHours: number;
  scheduledHours: number;
}

/**
 * Calculates a Utilization Score (Fairness).
 * 100% means they are exactly at their contracted hours.
 * < 100% means under-utilized.
 * > 100% means over-utilized (OT risk).
 */
export function calculateUtilization(scheduled: number, contracted: number): number {
  if (contracted <= 0) return 0;
  return (scheduled / contracted) * 100;
}

/**
 * Calculates the Gini Coefficient or similar Dispersion metric for a group.
 * Higher value = more inequality.
 */
export function calculateGroupInequality(employees: EmployeeFairness[]): number {
  if (employees.length <= 1) return 0;

  const utilizations = employees.map(e => calculateUtilization(e.scheduledHours, e.contractedHours));
  const mean = utilizations.reduce((a, b) => a + b, 0) / utilizations.length;
  
  if (mean === 0) return 0;

  // Mean Absolute Deviation from the ideal (100% utilization)
  const mad = utilizations.reduce((acc, val) => acc + Math.abs(val - 100), 0) / utilizations.length;
  
  return mad; // 0 is perfect "contractual" fairness
}

/**
 * Returns a color/status for a utilization percentage.
 */
export function getUtilizationStatus(percentage: number): 'under' | 'ideal' | 'over' | 'critical' {
  if (percentage < 80) return 'under';
  if (percentage <= 105) return 'ideal';
  if (percentage <= 120) return 'over';
  return 'critical';
}
