import React, { useState, useMemo, useCallback } from 'react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { cn } from '@/modules/core/lib/utils';
import {
  Search, Flame, Clock, CheckCircle, Loader2, Inbox,
  Calendar, Coffee, Users, UserCheck, ChevronUp, ChevronDown,
  ShieldCheck, ShieldAlert, AlertTriangle, XCircle, Shield
} from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { ComplianceDiagnosticDialog } from './ComplianceDiagnosticDialog';

import type { BidToggle, ManagerBidShift, EmployeeBid, ToggleCounts } from './types';
import { useManagerBidShifts } from './useOpenShifts';
import { useShiftBids } from './useShiftBids';
import { useTimeTicker } from './useTimeTicker';

// ============================================================================
// MAIN VIEW
// ============================================================================
export const OpenBidsView: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const orgSelection = useOrgSelection();

  useTimeTicker(60000);

  // State
  const [activeToggle, setActiveToggle] = useState<BidToggle>('urgent');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [assignedWinnerId, setAssignedWinnerId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  // Compliance State
  const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);
  const [pendingBidToCheck, setPendingBidToCheck] = useState<EmployeeBid | null>(null);

  // Data
  const { shifts, isLoading, refetch } = useManagerBidShifts({
    organizationId: orgSelection.organizationId,
    departmentId: orgSelection.departmentId,
    subDepartmentId: orgSelection.subDepartmentId,
  });
  const { bids, isLoading: isLoadingBids } = useShiftBids(expandedShiftId);

  // Counts per toggle
  const counts: ToggleCounts = useMemo(() => ({
    urgent: shifts.filter(s => s.toggle === 'urgent').length,
    normal: shifts.filter(s => s.toggle === 'normal').length,
    resolved: shifts.filter(s => s.toggle === 'resolved').length,
  }), [shifts]);

  // Filtered shifts
  const filteredShifts = useMemo(() => {
    let result = shifts.filter(s => s.toggle === activeToggle);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.role.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.subDepartment.toLowerCase().includes(q) ||
        s.stateId.toLowerCase().includes(q)
      );
    }
    return result;
  }, [shifts, activeToggle, searchQuery]);

  // The shift object for the currently expanded card
  const expandedShift = useMemo(
    () => shifts.find(s => s.id === expandedShiftId),
    [shifts, expandedShiftId]
  );

  // ========================================================================
  // HANDLERS
  // ========================================================================
  const toggleExpand = useCallback((shiftId: string) => {
    setExpandedShiftId(prev => (prev === shiftId ? null : shiftId));
    setAssignedWinnerId(null);
  }, []);

  const handleCheckCompliance = useCallback((bid: EmployeeBid) => {
    setPendingBidToCheck(bid);
    setIsComplianceModalOpen(true);
  }, []);

  const handleAssignConfirm = useCallback(async (bid: EmployeeBid) => {
    if (!expandedShiftId || !expandedShift || isAssigning) return;
    setIsAssigning(true);
    setIsComplianceModalOpen(false);

    try {
      const { error } = await (supabase as any).rpc('sm_select_bid_winner', {
        p_shift_id: expandedShiftId,
        p_winner_id: bid.employeeId,
        p_user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      if (error) throw error;

      setAssignedWinnerId(bid.employeeId);
      toast({
        title: 'Shift Assigned',
        description: `Successfully assigned to ${bid.employeeName}.`,
      });

      queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShifts(orgSelection.organizationId || '') });
      queryClient.invalidateQueries({ queryKey: shiftKeys.bids(expandedShiftId) });
    } catch (error: any) {
      toast({
        title: 'Assignment Failed',
        description: error.message || 'Failed to assign shift.',
        variant: 'destructive',
      });
    } finally {
      setIsAssigning(false);
    }
  }, [expandedShiftId, expandedShift, isAssigning, toast, queryClient, orgSelection.organizationId]);

  const handleAssign = useCallback((bid: EmployeeBid) => {
    setPendingBidToCheck(bid);
    setIsComplianceModalOpen(true);
  }, []);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-[#080c14] relative">

      {/* ── FUNCTION BAR ────────────────────────────────────────── */}
      <div className="shrink-0 z-20 h-14 px-5 border-b border-white/[0.06] bg-[#0a0f1a]/80 backdrop-blur-xl flex items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles, departments…"
            className="h-9 pl-9 bg-white/[0.03] border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 rounded-lg focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/20 transition-all"
          />
        </div>

        {/* Toggle Chips — Mutually Exclusive */}
        <div className="flex items-center gap-1.5">
          <ToggleChip
            active={activeToggle === 'urgent'}
            onClick={() => setActiveToggle('urgent')}
            icon={<Flame className="h-3 w-3" />}
            label="Urgent"
            count={counts.urgent}
            activeClass="bg-red-500/15 text-red-400 border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.1)]"
          />
          <ToggleChip
            active={activeToggle === 'normal'}
            onClick={() => setActiveToggle('normal')}
            icon={<Clock className="h-3 w-3" />}
            label="Normal"
            count={counts.normal}
            activeClass="bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.1)]"
          />
          <ToggleChip
            active={activeToggle === 'resolved'}
            onClick={() => setActiveToggle('resolved')}
            icon={<CheckCircle className="h-3 w-3" />}
            label="Resolved"
            count={counts.resolved}
            activeClass="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.1)]"
          />
        </div>

        {/* Total */}
        <div className="text-[11px] text-white/25 font-medium">
          {filteredShifts.length} shift{filteredShifts.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── CARD GRID ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
            <Loader2 className="h-7 w-7 animate-spin" />
            <span className="text-[11px] font-medium">Loading shifts…</span>
          </div>
        ) : filteredShifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-white/[0.03] rounded-2xl flex items-center justify-center mb-4 border border-white/[0.04]">
              <Inbox className="h-7 w-7 text-white/15" />
            </div>
            <p className="text-[13px] font-medium text-white/40 mb-1">No {activeToggle} shifts</p>
            <p className="text-[11px] text-white/20 max-w-[240px]">
              {activeToggle === 'resolved'
                ? 'No shifts have been assigned through bidding yet.'
                : 'There are no shifts in this category right now.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {filteredShifts.map(shift => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                isExpanded={expandedShiftId === shift.id}
                bids={expandedShiftId === shift.id ? bids : []}
                isLoadingBids={isLoadingBids}
                assignedWinnerId={assignedWinnerId}
                isAssigning={isAssigning}
                onToggleExpand={() => toggleExpand(shift.id)}
                onAssign={handleAssign}
                onCheckCompliance={handleCheckCompliance}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── COMPLIANCE DIALOG ──────────────────────────────────── */}
      <ComplianceDiagnosticDialog
        isOpen={isComplianceModalOpen}
        onClose={() => setIsComplianceModalOpen(false)}
        shift={expandedShift || null}
        bid={pendingBidToCheck}
        onAssign={handleAssignConfirm}
        isAssigning={isAssigning}
      />
    </div>
  );
};

// ============================================================================
// TOGGLE CHIP
// ============================================================================
interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  activeClass: string;
}

const ToggleChip: React.FC<ToggleChipProps> = ({ active, onClick, icon, label, count, activeClass }) => (
  <button
    onClick={onClick}
    className={cn(
      'px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 flex items-center gap-1.5 border',
      active
        ? activeClass
        : 'text-white/35 border-transparent hover:text-white/55 hover:bg-white/[0.03]'
    )}
  >
    {icon}
    {label}
    <span className={cn(
      'rounded-full px-1.5 min-w-[18px] text-center text-[10px] font-bold',
      active ? 'bg-white/10 text-inherit' : 'bg-white/[0.04] text-white/25'
    )}>
      {count}
    </span>
  </button>
);

// ============================================================================
// SHIFT CARD
// ============================================================================
interface ShiftCardProps {
  shift: ManagerBidShift;
  isExpanded: boolean;
  bids: EmployeeBid[];
  isLoadingBids: boolean;
  assignedWinnerId: string | null;
  isAssigning: boolean;
  onToggleExpand: () => void;
  onAssign: (bid: EmployeeBid) => void | Promise<void>;
  onCheckCompliance: (bid: EmployeeBid) => void | Promise<void>;
}

const ShiftCard: React.FC<ShiftCardProps> = ({
  shift,
  isExpanded,
  bids,
  isLoadingBids,
  assignedWinnerId,
  isAssigning,
  onToggleExpand,
  onAssign,
  onCheckCompliance,
}) => {
  const isResolved = shift.toggle === 'resolved';
  const hasAssignedWinner = !!assignedWinnerId || isResolved;

  return (
    <div className={cn(
      'relative flex flex-col rounded-xl border transition-all duration-200 overflow-hidden',
      'bg-white/[0.02]',
      isResolved
        ? 'border-emerald-500/15'
        : shift.isUrgent
          ? 'border-red-500/20'
          : 'border-white/[0.06]',
      isExpanded ? 'ring-1 ring-cyan-500/30 bg-white/[0.03]' : 'hover:bg-white/[0.04] hover:border-white/[0.12]'
    )}>

      {/* ── CORE CARD DETAILS ── */}
      <div className="p-4 relative">
        {/* Urgency Indicator */}
        {shift.isUrgent && (
          <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] text-red-400 font-bold">
            <Flame className="h-3 w-3" />
            URGENT
          </div>
        )}

        {/* Resolved Badge */}
        {isResolved && shift.assignedEmployeeName && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2 py-0.5">
            <UserCheck className="h-3 w-3" />
            Assigned
          </div>
        )}

        {/* Breadcrumb */}
        <div className="text-[10px] text-white/25 mb-1.5 tracking-wide pr-20">
          {shift.organization} → {shift.department}
          {shift.subDepartment && ` → ${shift.subDepartment}`}
        </div>

        {/* Role */}
        <h3 className="font-bold text-[15px] text-white/90 leading-tight mb-3">
          {shift.role}
        </h3>

        {/* Date + Time */}
        <div className="flex items-center gap-4 text-[11px] text-white/50 mb-1.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 text-white/25" />
            <span>{shift.dayLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-white/25" />
            <span>{shift.startTime} – {shift.endTime}</span>
          </div>
        </div>

        {/* Net + Breaks + Count Area */}
        <div className="flex items-center justify-between mt-3 text-[11px]">
          <div className="flex items-center gap-3 text-white/35">
            <div className="flex items-center gap-1">
              <Coffee className="h-3 w-3 text-white/20" />
              <span>Net {shift.netHours}h</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 font-medium text-white/40">
            <Users className="h-3.5 w-3.5" />
            <span>{shift.bidCount} Bid{shift.bidCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* ── FOOTER TOGGLE BAR ── */}
      <button
        onClick={onToggleExpand}
        className={cn(
          "h-9 flex items-center justify-center gap-2 border-t text-[11px] font-bold tracking-wide transition-all uppercase",
          isExpanded
            ? "border-cyan-500/20 bg-cyan-500/[0.04] text-cyan-400"
            : "border-white/[0.04] bg-white/[0.02] text-white/30 hover:text-white/50 hover:bg-white/[0.04]"
        )}
      >
        {isExpanded ? (
          <>Close Bids <ChevronUp className="h-3.5 w-3.5" /></>
        ) : (
          <>View Bids <ChevronDown className="h-3.5 w-3.5" /></>
        )}
      </button>

      {/* ── INLINE BID ACCORDION ── */}
      {isExpanded && (
        <div className="border-t border-cyan-500/10 bg-black/20 p-3 pt-4 animate-in slide-in-from-top-2 flex flex-col gap-2.5 max-h-[300px] overflow-y-auto">
          {isLoadingBids ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 text-cyan-500/50 animate-spin" />
            </div>
          ) : bids.length === 0 ? (
            <div className="flex justify-center flex-col items-center py-6 text-white/20">
              <Users className="h-6 w-6 mb-2 opacity-50" />
              <span className="text-[11px] font-medium">No bids received yet</span>
            </div>
          ) : (
            bids.map(bid => {
              const isWinner = assignedWinnerId === bid.employeeId || shift.assignedEmployeeId === bid.employeeId;
              const isDisabled = hasAssignedWinner && !isWinner;

              return (
                <div
                  key={bid.id}
                  className={cn(
                    'flex items-center justify-between gap-3 p-2.5 rounded-lg border transition-all duration-200',
                    isWinner
                      ? 'bg-emerald-500/[0.06] border-emerald-500/20'
                      : isDisabled
                        ? 'bg-white/[0.01] border-white/[0.02] opacity-50'
                        : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                  )}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <Avatar className="h-8 w-8 shrink-0 border border-white/[0.06]">
                      <AvatarImage src={`https://api.dicebear.com/7.x/personas/svg?seed=${bid.employeeName}`} />
                      <AvatarFallback className="bg-white/[0.04] text-white/50 text-[10px] font-bold">
                        {bid.employeeName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col truncate">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-white/90 truncate">{bid.employeeName}</span>
                        {isWinner && (
                          <Badge className="bg-emerald-500/15 text-emerald-400 text-[8px] px-1 py-0 h-3.5 border border-emerald-500/20 font-bold uppercase tracking-wide">
                            Winner
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-white/35 truncate">
                        {bid.employmentType}
                      </span>
                    </div>
                  </div>

                  {isWinner ? (
                    <div className="flex items-center gap-1 text-emerald-400 text-[10px] font-bold px-2 py-1 bg-emerald-500/10 rounded shrink-0">
                      <CheckCircle className="h-3 w-3" /> Assigned
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isDisabled || isAssigning}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCheckCompliance(bid);
                        }}
                        className="h-7 px-2 text-[9px] font-bold uppercase text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10"
                      >
                        {/* {isCheckingCompliance ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Shield className="h-3 w-3 mr-1" /> Check</>} */}
                        <Shield className="h-3 w-3 mr-1" /> Check
                      </Button>
                      <Button
                        size="sm"
                        disabled={isDisabled || isAssigning}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAssign(bid);
                        }}
                        className={cn(
                          'h-7 px-3 text-[10px] font-bold rounded-md transition-all uppercase tracking-wider',
                          isDisabled
                            ? 'bg-white/[0.02] text-white/20 border-0'
                            : 'bg-white/[0.05] hover:bg-cyan-500/15 text-white/60 hover:text-cyan-400'
                        )}
                      >
                        Assign
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default OpenBidsView;
