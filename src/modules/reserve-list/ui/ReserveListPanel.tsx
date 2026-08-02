/**
 * ReserveListPanel — manager-only emergency staffing workflow.
 *
 * Custom overlay (mirrors ShiftWizardModal's convention: NOT a Radix Dialog,
 * so nested portaled dropdowns/tooltips keep working). z-[60] — deliberately
 * above DrillDownPanel's z-50, since the Phone icon that opens this panel
 * lives on cards rendered *inside* DrillDownPanel (its "comfortable" shift
 * card variant); at z-40 (ShiftWizardModal's convention) this panel opened
 * silently behind DrillDownPanel and was invisible. Mounted once in
 * RostersPlannerPage, opened from any shift card via
 * useReserveListPanelStore.open(shiftId).
 *
 * Every open + every "Refresh" press runs a fresh, uncached search
 * (getReserveListCandidates) — see
 * docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §10, §12.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Phone, RefreshCw, ShieldCheck, X } from 'lucide-react';

import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';

import { supabase } from '@/platform/supabase/client';
import { shiftsQueries } from '@/modules/rosters/api/shifts.queries';
import { calculateMinutesBetweenTimes, type Shift } from '@/modules/rosters/domain/shift.entity';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';

import { useReserveListPanelStore } from '../state/useReserveListPanelStore';
import { getReserveListCandidates, assignFromReserveList } from '../api/reserveList.api';
import type { ReserveListCandidate } from '../model/reserveList.types';

export const ReserveListPanel: React.FC = () => {
  const isOpen = useReserveListPanelStore((s) => s.isOpen);
  const shiftId = useReserveListPanelStore((s) => s.shiftId);
  const close = useReserveListPanelStore((s) => s.close);

  if (!isOpen || !shiftId) return null;
  return <ReserveListPanelInner key={shiftId} shiftId={shiftId} onClose={close} />;
};

const ReserveListPanelInner: React.FC<{ shiftId: string; onClose: () => void }> = ({ shiftId, onClose }) => {
  const { isDark } = useTheme();
  const { toast } = useToast();

  const [shift, setShift] = useState<Shift | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ReserveListCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [freshShift, freshCandidates] = await Promise.all([
        shiftsQueries.getShiftById(shiftId),
        getReserveListCandidates(shiftId),
      ]);
      setShift(freshShift);
      setCandidates(freshCandidates);

      if (freshShift?.role_id) {
        const { data } = await supabase.from('roles').select('name').eq('id', freshShift.role_id).single();
        setRoleName((data as { name?: string } | null)?.name ?? null);
      } else {
        setRoleName(null);
      }
    } catch (e: any) {
      console.error('[ReserveListPanel] Search failed:', e);
      setError(e?.message ?? 'Failed to load Reserve List candidates.');
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  const handleRunCompliance = async (candidate: ReserveListCandidate) => {
    if (!shift) return;
    setVerifyingId(candidate.employeeId);
    try {
      const netMinutes =
        calculateMinutesBetweenTimes(shift.start_time, shift.end_time) - (shift.unpaid_break_minutes || 0);
      const compliance = await validateCompliance({
        employeeId: candidate.employeeId,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        netLengthMinutes: netMinutes,
        shiftId: shift.id,
      });

      if (compliance.status !== 'passed' && compliance.status !== 'warned') {
        // No longer eligible — drop from the list rather than show a stale pass.
        setCandidates((prev) => prev.filter((c) => c.employeeId !== candidate.employeeId));
        toast({
          title: `${candidate.name} is no longer eligible`,
          description: compliance.violations[0] ?? 'This candidate now fails compliance.',
          variant: 'destructive',
        });
        return;
      }

      setCandidates((prev) =>
        prev.map((c) =>
          c.employeeId === candidate.employeeId
            ? {
                ...c,
                complianceStatus: compliance.status,
                violations: compliance.violations,
                warnings: compliance.warnings,
                currentWeeklyHours: compliance.weeklyHours,
              }
            : c,
        ),
      );
      toast({ title: 'Compliance re-verified', description: `${candidate.name} still passes.` });
    } catch (e: any) {
      toast({ title: 'Compliance check failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleAssign = async (candidate: ReserveListCandidate) => {
    if (!shift) return;
    setAssigningId(candidate.employeeId);
    try {
      const result = await assignFromReserveList(shift.id, candidate.employeeId, shift.version);
      if (result.success) {
        toast({
          title: 'Shift assigned',
          description: result.warning ?? `${candidate.name} has been assigned and the shift published.`,
        });
        onClose();
        return;
      }

      toast({ title: 'Assignment failed', description: result.message, variant: 'destructive' });
      // STALE / CANDIDATE_NO_LONGER_ELIGIBLE both mean the pool moved under us —
      // force a fresh search rather than let the manager retry against stale data.
      if (result.reason === 'STALE' || result.reason === 'CANDIDATE_NO_LONGER_ELIGIBLE') {
        await runSearch();
      }
    } catch (e: any) {
      toast({ title: 'Assignment failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setAssigningId(null);
    }
  };

  const surface = isDark
    ? 'bg-[#0c0e14] border-white/10 text-white'
    : 'bg-white border-slate-200 text-slate-900';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Reserve List"
    >
      <div
        className={cn(
          'relative flex w-full max-w-[880px] max-h-[85vh] flex-col overflow-hidden rounded-3xl border shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-200',
          surface,
        )}
      >
        {/* ── ACTION BAR ── */}
        <div
          className={cn(
            'flex flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-3 sm:px-5 backdrop-blur-xl',
            isDark ? 'border-white/5 bg-[#0c0e14]/80' : 'border-border/50 bg-card/80',
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
              <Phone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] truncate">Reserve List</h2>
              {shift && (
                <p className="text-xs text-muted-foreground truncate">
                  {roleName ?? 'Any role'} · {shift.shift_date} · {shift.start_time}–{shift.end_time}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={runSearch}
              disabled={loading}
              className="h-9 gap-1.5 rounded-xl px-3 text-xs font-bold"
              title="Run a fresh search — never uses cached data"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-xl"
              aria-label="Close Reserve List"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── BODY ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 sm:p-5 space-y-2.5">
            {loading && candidates.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-xs font-semibold uppercase tracking-wider">Searching for eligible employees…</p>
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-rose-400">
                <p className="text-sm font-semibold">{error}</p>
                <Button type="button" variant="outline" size="sm" onClick={runSearch}>Try again</Button>
              </div>
            )}

            {!loading && !error && candidates.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-1.5 text-center text-muted-foreground">
                <p className="text-sm font-semibold">No eligible employees found.</p>
                <p className="text-xs max-w-sm">
                  No one who has opted into the Reserve List currently passes availability, compliance, and
                  overlap checks for this shift. Try Refresh once someone opts in or becomes free.
                </p>
              </div>
            )}

            {candidates.map((c) => (
              <div
                key={c.employeeId}
                className={cn(
                  'flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border px-4 py-3 transition-colors',
                  isDark ? 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]' : 'border-slate-200 bg-slate-50 hover:bg-slate-100',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">{c.name || c.email || c.employeeId}</span>
                    <Badge variant={c.complianceStatus === 'passed' ? 'success' : 'warning'} className="text-[10px]">
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      {c.complianceStatus === 'passed' ? 'Compliant' : 'Warning'}
                    </Badge>
                    {c.contractType && (
                      <Badge variant="outline" className="text-[10px]">{c.contractType}</Badge>
                    )}
                    <Badge
                      variant={c.availability.verdict === 'available' ? 'success' : 'warning'}
                      className="text-[10px]"
                    >
                      {c.availability.verdict === 'available' ? 'Available' : 'Availability unconfirmed'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {roleName ?? 'Any role'} · {c.currentWeeklyHours.toFixed(1)}h / {c.maxWeeklyHours}h this week
                  </p>
                  {(c.warnings.length > 0 || c.availability.message) && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      {[c.availability.message, ...c.warnings].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 self-start sm:self-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRunCompliance(c)}
                    disabled={verifyingId === c.employeeId || assigningId !== null}
                    className="h-8 gap-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide"
                  >
                    {verifyingId === c.employeeId
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ShieldCheck className="h-3.5 w-3.5" />}
                    Run Compliance
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleAssign(c)}
                    disabled={assigningId !== null || verifyingId === c.employeeId}
                    className="h-8 gap-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 text-[10px] font-black uppercase tracking-wide"
                  >
                    {assigningId === c.employeeId
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Phone className="h-3.5 w-3.5" />}
                    Assign
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default ReserveListPanel;
