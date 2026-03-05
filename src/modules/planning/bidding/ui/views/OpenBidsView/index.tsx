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
// HELPERS
// ============================================================================
function getCardBg(groupType: string | null | undefined, dept: string): string {
  const base = 'dept-card-glass-base';
  if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
    return `${base} dept-card-glass-convention`;
  if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
    return `${base} dept-card-glass-exhibition`;
  if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
    return `${base} dept-card-glass-theatre`;
  return `${base} dept-card-glass-default`;
}

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
    <div className="flex flex-col h-[calc(100vh-64px)] bg-background relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.05] blur-[120px] rounded-full pointer-events-none" />

      {/* ── FUNCTION BAR ────────────────────────────────────────── */}
      <div className="shrink-0 z-20 h-16 px-6 border-b border-border bg-card/80 backdrop-blur-xl flex items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-80 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles, departments…"
            className="h-10 pl-10 bg-muted/30 border-border text-sm text-foreground placeholder:text-muted-foreground/40 rounded-xl focus:ring-1 focus:ring-primary/30 transition-all font-medium"
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
            activeClass="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 shadow-sm shadow-rose-500/5 font-black"
          />
          <ToggleChip
            active={activeToggle === 'normal'}
            onClick={() => setActiveToggle('normal')}
            icon={<Clock className="h-3 w-3" />}
            label="Normal"
            count={counts.normal}
            activeClass="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 shadow-sm shadow-amber-500/5 font-black"
          />
          <ToggleChip
            active={activeToggle === 'resolved'}
            onClick={() => setActiveToggle('resolved')}
            icon={<CheckCircle className="h-3 w-3" />}
            label="Resolved"
            count={counts.resolved}
            activeClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shadow-sm shadow-emerald-500/5 font-black"
          />
        </div>

        {/* Total */}
        <div className="text-[11px] text-muted-foreground/40 font-mono font-black uppercase tracking-widest">
          {filteredShifts.length} shift{filteredShifts.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── CARD GRID ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/20">
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em]">Loading Bids Console…</span>
          </div>
        ) : filteredShifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-20 h-20 bg-muted/30 rounded-3xl flex items-center justify-center mb-6 border border-border shadow-inner">
              <Inbox className="h-9 w-9 text-muted-foreground/20" />
            </div>
            <p className="text-sm font-black text-foreground/40 mb-2 uppercase tracking-[0.2em]">No {activeToggle} shifts found</p>
            <p className="text-[11px] text-muted-foreground/40 font-mono font-black max-w-[280px]">
              {activeToggle === 'resolved'
                ? 'COMPLETED ASSIGNMENTS WILL APPEAR HERE ONCE FINALIZED.'
                : 'CHECK BACK LATER OR ADJUST YOUR SEARCH PARAMETERS.'}
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
      'px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all duration-300 flex items-center gap-2 border',
      active
        ? activeClass
        : 'text-muted-foreground/40 border-transparent hover:text-foreground hover:bg-muted/50'
    )}
  >
    {icon}
    {label}
    <span className={cn(
      'rounded-full px-1.5 min-w-[20px] h-[20px] flex items-center justify-center text-[9px] font-black',
      active ? 'bg-primary/10 text-inherit' : 'bg-muted text-muted-foreground/30'
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
      'relative flex flex-col rounded-[1.5rem] border transition-all duration-500 overflow-hidden',
      getCardBg(shift.groupType, shift.department),
      isExpanded
        ? 'ring-2 ring-primary/20 shadow-2xl scale-[1.02] z-10'
        : 'hover:shadow-xl hover:translate-y-[-4px] hover:border-primary/40'
    )}>

      {/* ── CORE CARD DETAILS ── */}
      <div className="p-5 relative">
        {/* Urgency Indicator */}
        {shift.isUrgent && (
          <div className="absolute top-4 right-4 flex items-center gap-1 text-[9px] text-rose-600 dark:text-rose-400 font-black tracking-widest bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20 backdrop-blur-md">
            <Flame className="h-3 w-3" />
            URGENT
          </div>
        )}

        {/* Resolved Badge */}
        {isResolved && shift.assignedEmployeeName && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 text-[9px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1 backdrop-blur-md">
            <UserCheck className="h-3 w-3" />
            Assigned
          </div>
        )}

        {/* Breadcrumb */}
        <div className="text-[10px] text-muted-foreground/60 mb-2 tracking-[0.1em] font-mono font-black pr-20 uppercase">
          {shift.organization} <span className="text-primary/30 mx-0.5">/</span> {shift.department}
          {shift.subDepartment && <> <span className="text-primary/30 mx-0.5">/</span> {shift.subDepartment}</>}
        </div>

        {/* Role */}
        <h3 className="font-black text-xl text-foreground leading-tight mb-5 tracking-tight group-hover:text-primary transition-colors">
          {shift.role}
        </h3>

        {/* Date + Time */}
        <div className="flex items-center gap-4 text-[11px] text-foreground/80 mb-2">
          <div className="flex items-center gap-1.5 bg-muted/40 px-2.5 py-1.5 rounded-xl border border-border/50 backdrop-blur-md">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span className="font-black font-mono">{shift.dayLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-muted/40 px-2.5 py-1.5 rounded-xl border border-border/50 backdrop-blur-md">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="font-black font-mono">{shift.startTime} – {shift.endTime}</span>
          </div>
        </div>

        {/* Net + Breaks + Count Area */}
        <div className="flex items-center justify-between mt-6">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
            <div className="flex items-center gap-1.5 bg-muted/20 px-2 py-1 rounded-lg">
              <Coffee className="h-3.5 w-3.5 text-orange-500/60" />
              <span className="font-black font-mono">Net {shift.netHours}h</span>
            </div>
          </div>
          <div className="flex items-center gap-2 font-black font-mono text-[10px] text-primary bg-primary/10 px-3 py-1.5 rounded-xl border border-primary/20 backdrop-blur-md shadow-sm">
            <Users className="h-3.5 w-3.5" />
            <span>{shift.bidCount} {shift.bidCount === 1 ? 'BID' : 'BIDS'}</span>
          </div>
        </div>
      </div>

      {/* ── FOOTER TOGGLE BAR ── */}
      <button
        onClick={onToggleExpand}
        className={cn(
          "h-12 flex items-center justify-center gap-3 border-t text-[11px] font-black tracking-[0.3em] transition-all uppercase px-6",
          isExpanded
            ? "bg-primary/20 text-primary border-primary/30 backdrop-blur-md"
            : "bg-primary/5 text-primary/80 hover:text-primary hover:bg-primary/10 hover:border-primary/30 border-transparent backdrop-blur-sm"
        )}
      >
        {isExpanded ? (
          <>Collapse Console <ChevronUp className="h-4 w-4" /></>
        ) : (
          <>Review Bids <ChevronDown className="h-4 w-4" /></>
        )}
      </button>

      {/* ── INLINE BID ACCORDION ── */}
      {isExpanded && (
        <div className="border-t border-primary/10 bg-muted/30 p-4 animate-in slide-in-from-top-4 duration-300 flex flex-col gap-3 max-h-[400px] overflow-y-auto shadow-inner">
          {isLoadingBids ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 text-primary/40 animate-spin" />
            </div>
          ) : bids.length === 0 ? (
            <div className="flex justify-center flex-col items-center py-10 text-muted-foreground/30">
              <Users className="h-8 w-8 mb-3 opacity-20" />
              <span className="text-[10px] font-black uppercase tracking-widest font-mono">No active bids received</span>
            </div>
          ) : (
            bids.map(bid => {
              const isWinner = assignedWinnerId === bid.employeeId || shift.assignedEmployeeId === bid.employeeId;
              const isDisabled = hasAssignedWinner && !isWinner;

              return (
                <div
                  key={bid.id}
                  className={cn(
                    'flex items-center justify-between gap-4 p-3 rounded-2xl border transition-all duration-300',
                    isWinner
                      ? 'bg-emerald-500/5 border-emerald-500/20 shadow-emerald-500/5'
                      : isDisabled
                        ? 'bg-muted/10 border-border/50 opacity-40grayscale pointer-events-none'
                        : 'bg-card border-border hover:border-primary/30 hover:shadow-md'
                  )}
                >
                  <div className="flex items-center gap-4 overflow-hidden">
                    <Avatar className="h-10 w-10 shrink-0 ring-1 ring-border shadow-sm">
                      <AvatarImage src={`https://api.dicebear.com/7.x/personas/svg?seed=${bid.employeeName}`} />
                      <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-black">
                        {bid.employeeName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col truncate">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-black text-foreground truncate tracking-tight">{bid.employeeName}</span>
                        {isWinner && (
                          <Badge className="bg-emerald-500 text-white text-[8px] px-1.5 py-0 h-4 border-none font-black uppercase tracking-wider">
                            Winner
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground/60 truncate font-mono font-black uppercase tracking-wider">
                        {bid.employmentType}
                      </span>
                    </div>
                  </div>

                  {isWinner ? (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-sm shrink-0">
                      <CheckCircle className="h-3.5 w-3.5" /> Assigned
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isDisabled || isAssigning}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCheckCompliance(bid);
                        }}
                        className="h-9 px-3 text-[9px] font-black uppercase tracking-wider text-primary/60 hover:text-primary hover:bg-primary/10 rounded-xl"
                      >
                        <Shield className="h-3.5 w-3.5 mr-1.5" /> Check
                      </Button>
                      <Button
                        size="sm"
                        disabled={isDisabled || isAssigning}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAssign(bid);
                        }}
                        className={cn(
                          'h-9 px-4 text-[10px] font-black rounded-xl transition-all uppercase tracking-[0.2em] shadow-lg shadow-primary/20',
                          isDisabled
                            ? 'bg-muted text-muted-foreground/30 border-0'
                            : 'bg-primary text-primary-foreground hover:bg-primary/90'
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
      )
      }
    </div >
  );
};

export default OpenBidsView;
