// src/modules/planning/bidding/ui/views/OpenBidsView/useShiftBids.ts

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { computeSss } from '../../utils/sss';
import type { BidEligibility, EmployeeBid } from './types';

interface UseShiftBidsReturn {
  bids: EmployeeBid[];
  isLoading: boolean;
  refetch: () => void;
}

/** Current calendar quarter (1–4) + year, for the performance report RPC. */
function currentYearQuarter(): { year: number; quarter: number } {
  const d = new Date();
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

interface PerfRow {
  employee_id: string;
  reliability_score: number | null;
  attendance_compliance_rate: number | null;
  acceptance_rate: number | null;
  no_show_rate: number | null;
  late_cancel_rate: number | null;
  total_offers: number | null;
  total_bids: number | null;
}

/** Non-expired held qualification ids for a set of employees (batched). */
async function loadHeldQualifications(empIds: string[]): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>();
  if (empIds.length === 0) return held;
  const today = new Date().toISOString().slice(0, 10);
  const notExpired = (exp: string | null) => !exp || exp >= today;
  const add = (empId: string, qual: string | null) => {
    if (!qual) return;
    if (!held.has(empId)) held.set(empId, new Set());
    held.get(empId)!.add(qual);
  };

  const [skills, licenses] = await Promise.all([
    supabase.from('employee_skills').select('employee_id, skill_id, expiration_date').in('employee_id', empIds),
    supabase.from('employee_licenses').select('employee_id, license_id, expiration_date').in('employee_id', empIds),
  ]);
  for (const s of (skills.data ?? []) as any[]) if (notExpired(s.expiration_date)) add(s.employee_id, s.skill_id);
  for (const l of (licenses.data ?? []) as any[]) if (notExpired(l.expiration_date)) add(l.employee_id, l.license_id);
  return held;
}

export function useShiftBids(shiftId: string | null): UseShiftBidsReturn {
  const {
    data: bids = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: shiftKeys.bids(shiftId || ''),
    queryFn: async () => {
      if (!shiftId) return [];

      // 1. Bids + bidder profiles.
      const { data: rows, error } = await supabase
        .from('shift_bids')
        .select(`
          id, shift_id, employee_id, status, created_at,
          profiles!shift_bids_employee_id_fkey(
            id, full_name, first_name, last_name, employment_type
          )
        `)
        .eq('shift_id', shiftId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching shift bids:', error);
        return [];
      }

      const empIds = [...new Set((rows || []).map((b: any) => b.employee_id).filter(Boolean))] as string[];
      if (empIds.length === 0) return [];

      // 2. Shift requirements (for the per-shift skill/qualification match).
      const { data: shiftRow } = await supabase
        .from('shifts')
        .select('organization_id, role_id, required_skills, required_licenses')
        .eq('id', shiftId)
        .maybeSingle();
      const required: string[] = [
        ...(((shiftRow as any)?.required_skills as string[] | null) ?? []),
        ...(((shiftRow as any)?.required_licenses as string[] | null) ?? []),
      ];
      const orgId = (shiftRow as any)?.organization_id as string | undefined;

      // 3. Real per-employee performance (batched, current quarter, org-scoped).
      const perfMap = new Map<string, PerfRow>();
      if (orgId) {
        try {
          const { year, quarter } = currentYearQuarter();
          const { data: report } = await (supabase as any).rpc('get_quarterly_performance_report', {
            p_year: year,
            p_quarter: quarter,
            p_org_ids: [orgId],
          });
          for (const r of (report ?? []) as PerfRow[]) perfMap.set(r.employee_id, r);
        } catch (e) {
          console.warn('[useShiftBids] performance report unavailable → SSS falls back to skill match', e);
        }
      }

      // 4. Batched held-qualifications for the skill match.
      const held = await loadHeldQualifications(empIds);

      // 5. Optional precomputed override (employee_suitability_scores.overall_score).
      const overrideMap = new Map<string, number>();
      try {
        const { data: scores } = await supabase
          .from('employee_suitability_scores')
          .select('employee_id, overall_score')
          .in('employee_id', empIds);
        for (const s of (scores ?? []) as any[]) {
          if (typeof s.overall_score === 'number') overrideMap.set(s.employee_id, s.overall_score);
        }
      } catch { /* table optional */ }

      // 6. Assemble.
      return (rows || []).map((b: any): EmployeeBid => {
        const profile = b.profiles;
        const name = profile
          ? (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown')
          : 'Unknown';
        const empId = b.employee_id as string;

        // Skill match + eligibility from the batched qualification sets.
        let skillMatch = 100;
        let eligibility: BidEligibility = 'pass';
        if (required.length > 0) {
          const owned = held.get(empId) ?? new Set<string>();
          const met = required.filter((q) => owned.has(q)).length;
          skillMatch = Math.round((met / required.length) * 100);
          eligibility = met === required.length ? 'pass' : 'blocked';
        }

        const perf = perfMap.get(empId);
        const hasHistory = !!perf && ((perf.total_offers ?? 0) + (perf.total_bids ?? 0) > 0);

        const composed = computeSss({
          reliability: perf?.reliability_score,
          attendance: perf?.attendance_compliance_rate,
          acceptance: perf?.acceptance_rate,
          noShowRate: perf?.no_show_rate,
          lateCancelRate: perf?.late_cancel_rate,
          skillMatch,
          hasHistory,
        });

        const override = overrideMap.get(empId);
        const sss = typeof override === 'number' ? Math.min(100, Math.max(0, Math.round(override))) : composed.score;

        return {
          id: b.id,
          shiftId: b.shift_id,
          employeeId: empId,
          employeeName: name,
          employmentType: profile?.employment_type || 'Casual',
          status: b.status,
          submittedAt: b.created_at,
          isWinner: b.status === 'accepted' || b.status === 'assigned',
          sss,
          sssFlag: composed.flag,
          sssBreakdown: composed.breakdown,
          eligibility,
        };
      });
    },
    enabled: !!shiftId,
    staleTime: 10000,
  });

  return { bids, isLoading, refetch };
}
