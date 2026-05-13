import React, { useState } from 'react';
import { isShiftLocked, isShiftCommenced } from '@/modules/rosters/domain/shift-locking.utils';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import {
  X,
  ArrowLeftRight,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { Shift } from '@/modules/rosters';
import { useDropShift } from '@/modules/rosters/state/useRosterShifts';
import { AttendanceBadge } from '@/modules/rosters/ui/components/AttendanceBadge';

import { useSwaps } from '@/modules/planning';
import { useToast } from '@/modules/core/hooks/use-toast';
import CreateSwapRequestModal from './CreateSwapRequestModal';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { estimateDetailedCostFromShift } from '@/modules/rosters/domain/projections/utils/cost';
import { ZERO_COST_BREAKDOWN } from '@/modules/rosters/domain/projections/utils/cost/constants';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

interface ShiftWithDetails {
  shift: Shift;
  groupName: string;
  groupColor: string;
  subGroupName: string;
}

interface ShiftDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shiftData: ShiftWithDetails | null;
  shiftDate: Date;
}

// ── Cost Tooltip ──────────────────────────────────────────────────────────
export const CostBreakdownTooltip: React.FC<{ breakdown: any }> = ({ breakdown }) => {
  if (!breakdown) return null;
  const { totalCost, ordinaryCost, overtimeCost, allowanceCost, ordinaryHours, overtimeHours, breakdown: details } = breakdown;
  return (
      <div className="space-y-2 p-1 min-w-[180px]">
          <div className="flex justify-between items-center pb-1 border-b border-white/10">
              <span className="text-[10px] uppercase tracking-wider opacity-60">Estimated Pay</span>
              <span className="text-xs font-bold text-emerald-400">${totalCost.toFixed(2)}</span>
          </div>
          <div className="space-y-1 text-[10px]">
              <div className="flex justify-between">
                  <span>Ordinary ({ordinaryHours.toFixed(1)}h @ ${details.penaltyRate.toFixed(2)})</span>
                  <span>${ordinaryCost.toFixed(2)}</span>
              </div>
              {overtimeCost > 0 && (
                  <div className="flex justify-between text-orange-300">
                      <span>Overtime ({overtimeHours.toFixed(1)}h)</span>
                      <span>${overtimeCost.toFixed(2)}</span>
                  </div>
              )}
              {allowanceCost > 0 && (
                  <div className="flex justify-between text-blue-300">
                      <span>Night Allowance ({details.nightHours.toFixed(1)}h)</span>
                      <span>${allowanceCost.toFixed(2)}</span>
                  </div>
              )}
          </div>
          <div className="pt-1 text-[9px] opacity-40 italic border-t border-white/5">
              Calculated per ICC Sydney EA 2025
          </div>
      </div>
  );
};

const ShiftDetailsDialog: React.FC<ShiftDetailsDialogProps> = ({
  isOpen,
  onClose,
  shiftData,
}) => {
  const { toast } = useToast();
  const { mySwapRequests, myActiveOfferDetails, isLoadingOfferDetails } = useSwaps();

  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const dropShiftMutation = useDropShift();
  const isDropping = dropShiftMutation.isPending;

  const isPast = React.useMemo(() => {
    if (!shiftData?.shift?.shift_date || !shiftData?.shift?.end_time) return false;
    try {
      const endStr = `${shiftData.shift.shift_date}T${shiftData.shift.end_time}`;
      return new Date(endStr).getTime() < Date.now();
    } catch {
      return false;
    }
  }, [shiftData?.shift?.shift_date, shiftData?.shift?.end_time]);

  const isWithinLockoutPeriod = React.useMemo(() => 
    shiftData ? isShiftLocked(shiftData.shift.shift_date, shiftData.shift.start_time, 'my_roster') : false
  , [shiftData]);

  const isCommenced = React.useMemo(() => 
    shiftData ? isShiftCommenced(shiftData.shift.shift_date, shiftData.shift.start_time) : false
  , [shiftData]);

  const existingSwapRequest = React.useMemo(() => 
    mySwapRequests.find(
      s => (s.requester_shift_id === shiftData?.shift.id || s.target_shift_id === shiftData?.shift.id) &&
        (s.status === 'OPEN' || s.status === 'MANAGER_PENDING')
    )
  , [mySwapRequests, shiftData?.shift.id]);

  const isPendingInOffer = React.useMemo(() => 
    isLoadingOfferDetails
      ? true
      : myActiveOfferDetails?.some(offer => offer.offered_shift_id === shiftData?.shift.id)
  , [isLoadingOfferDetails, myActiveOfferDetails, shiftData?.shift.id]);

  const isActiveOrCommenced = shiftData?.shift.lifecycle_status === 'InProgress' || shiftData?.shift.lifecycle_status === 'Completed' || isCommenced;
  const hasCheckedIn = shiftData?.shift.attendance_status === 'checked_in' || shiftData?.shift.attendance_status === 'late';

  const isS3PendingOffer = shiftData?.shift.lifecycle_status === 'Published' && shiftData?.shift.assignment_status === 'assigned' && !shiftData?.shift.assignment_outcome;

  const isLockedFromActions = shiftData?.shift.is_cancelled || !!existingSwapRequest || isPendingInOffer || isWithinLockoutPeriod || isS3PendingOffer || isActiveOrCommenced || hasCheckedIn || isPast;

  const paidBreak = (shiftData?.shift as any)?.paid_break_minutes ?? 0;
  const unpaidBreak = (shiftData?.shift as any)?.unpaid_break_minutes ?? shiftData?.shift.break_minutes ?? 0;

  const netLengthMinutes = React.useMemo(() => {
    if (!shiftData?.shift.start_time || !shiftData?.shift.end_time) return 0;
    const [sh, sm] = shiftData.shift.start_time.split(':').map(Number);
    const [eh, em] = shiftData.shift.end_time.split(':').map(Number);
    let gross = (eh * 60 + em) - (sh * 60 + sm);
    if (gross < 0) gross += 1440;
    return Math.max(0, gross - unpaidBreak);
  }, [shiftData?.shift.start_time, shiftData?.shift.end_time, unpaidBreak]);

  const urgency = computeShiftUrgency(shiftData?.shift.shift_date || '', shiftData?.shift.start_time || '', (shiftData?.shift as any)?.start_at);

  const groupVariant = (() => {
    if (!shiftData?.shift) return 'default' as const;
    const s = shiftData.shift;
    if (s.group_type === 'convention_centre') return 'convention' as const;
    if (s.group_type === 'exhibition_centre') return 'exhibition' as const;
    if (s.group_type === 'theatre') return 'theatre' as const;

    const name = (s.departments?.name || '').toLowerCase();
    if (name.includes('convention')) return 'convention' as const;
    if (name.includes('exhibition')) return 'exhibition' as const;
    if (name.includes('theatre') || name.includes('theater')) return 'theatre' as const;
    return 'default' as const;
  })();

  const swapLabel = 'Swap';
  const dropLabel = 'Drop';

  // ── Cost Calculation ──────────────────────────────────────────────────────
  const costBreakdown = React.useMemo(() => {
    if (!shiftData?.shift) return ZERO_COST_BREAKDOWN;
    return estimateDetailedCostFromShift(shiftData.shift);
  }, [shiftData?.shift]);

  if (!shiftData) return null;
  const { shift, groupName, groupColor, subGroupName } = shiftData;

  const shiftDate = new Date(shift.shift_date);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleDropShift = () => setIsCancelConfirmOpen(true);
  const handleSwapShift = () => setIsSwapModalOpen(true);

  const confirmDrop = async () => {
    if (!cancelReason.trim()) {
      toast({ title: 'Reason Required', description: 'Please provide a reason for dropping this shift.', variant: 'destructive' });
      return;
    }
    if (isWithinLockoutPeriod) {
      toast({ title: 'Drop Not Allowed', description: 'Cannot drop shift within 4 hours of start time.', variant: 'destructive' });
      return;
    }
    dropShiftMutation.mutate(
      { shiftId: shift.id, reason: cancelReason.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Shift Dropped', description: 'You have successfully dropped this shift. It is now available for bidding.' });
          setIsCancelConfirmOpen(false);
          setCancelReason('');
          onClose();
        },
        onError: (error: any) => {
          toast({ title: 'Drop Failed', description: error?.message || error?.error?.message || 'Failed to drop shift.', variant: 'destructive' });
        }
      }
    );
  };

  return (
    <>
      <ResponsiveDialog
        open={isOpen}
        onOpenChange={onClose}
        dialogClassName="max-w-md p-0 overflow-hidden backdrop-blur-3xl bg-white/60 dark:bg-zinc-950/95 border border-white/10 shadow-2xl rounded-[32px]"
        drawerClassName="backdrop-blur-3xl bg-white/60 dark:bg-zinc-950/95 border-t border-white/10 rounded-t-[32px]"
      >
        <ResponsiveDialog.Header className="sr-only">
          <ResponsiveDialog.Title>{shift.roles?.name || 'Shift'} Details</ResponsiveDialog.Title>
          <ResponsiveDialog.Description>
            Shift details for {format(shiftDate, 'EEEE, MMMM d, yyyy')}
          </ResponsiveDialog.Description>
        </ResponsiveDialog.Header>

        {/* Shift Card Content */}
        <div className="p-0">
          <SharedShiftCard
            variant="timecard"
            isFlat={true}
            organization={shift.organizations?.name || ''}
            department={shift.departments?.name || ''}
            subGroup={shift.sub_departments?.name || subGroupName}
            role={shift.roles?.name || 'Shift'}
            shiftDate={format(shiftDate, 'EEE, MMM d, yyyy')}
            startTime={shift.start_time.slice(0, 5)}
            endTime={shift.end_time.slice(0, 5)}
            netLength={netLengthMinutes}
            paidBreak={paidBreak}
            unpaidBreak={unpaidBreak}
            urgency={urgency}
            groupVariant={groupVariant}
            isPast={isPast}
            shiftData={shift}
            lifecycleStatus={shift.lifecycle_status}
            className="pb-8" // Add some bottom padding for mobile drawers
            estimatedPay={(
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-end gap-1.5 cursor-help group/pay">
                    <span className="text-[14px] font-black text-emerald-500 tabular-nums">
                      ${(costBreakdown.totalCost || 0).toFixed(2)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-slate-900 text-white border-white/10 shadow-2xl" side="top">
                  <CostBreakdownTooltip breakdown={costBreakdown} />
                </TooltipContent>
              </Tooltip>
            )}
            statusIcons={null}
            footerActions={
              <div className="flex flex-col gap-2 w-full">
                {!isLockedFromActions && (
                  <div className="flex gap-2">
                      <Button
                          onClick={handleSwapShift}
                          className={cn(
                              'flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all active:scale-95 shadow-md',
                              'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20'
                          )}
                      >
                      <ArrowLeftRight size={16} className="mr-2" />
                      {swapLabel}
                      </Button>
                      <Button
                          onClick={handleDropShift}
                          className={cn(
                              'flex-1 h-12 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all active:scale-95 shadow-md',
                              'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20'
                          )}
                      >
                      <X size={16} className="mr-2" />
                      {dropLabel}
                      </Button>
                  </div>
                )}
                {isWithinLockoutPeriod && !isPast && !isActiveOrCommenced && (
                  <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 font-mono">
                      {"Emergent State: Lockout Active (<4h)"}
                    </span>

                  </div>
                )}
              </div>
            }

          />
        </div>

      </ResponsiveDialog>

      {/* Swap Request Modal */}
      <CreateSwapRequestModal
        isOpen={isSwapModalOpen}
        onClose={() => setIsSwapModalOpen(false)}
        shift={shift}
        shiftDate={shiftDate}
        groupName={groupName}
        subGroupName={subGroupName}
        groupColor={groupColor}
      />

      {/* Drop Shift Confirmation Dialog */}
      <ResponsiveDialog
        open={isCancelConfirmOpen}
        onOpenChange={setIsCancelConfirmOpen}
      >
        <ResponsiveDialog.Header>
          <ResponsiveDialog.Title>Cancel Shift Assignment</ResponsiveDialog.Title>
          <ResponsiveDialog.Description>
            Are you sure you want to drop this shift? Depending on the timing, this may require manager approval or affect your reliability score.
          </ResponsiveDialog.Description>
        </ResponsiveDialog.Header>
        <ResponsiveDialog.Body className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason for cancellation</Label>
            <Textarea
              id="cancel-reason"
              placeholder="Please explain why you cannot work this shift..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          {isWithinLockoutPeriod && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm">
              Warning: You are dropping this shift within 4 hours of start time.
            </div>
          )}
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="outline" onClick={() => setIsCancelConfirmOpen(false)} disabled={isDropping}>
            Keep Shift
          </Button>
          <Button variant="destructive" onClick={confirmDrop} disabled={isDropping || !cancelReason.trim()}>
            {isDropping ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Dropping...</>
            ) : (
              'Confirm Drop'
            )}
          </Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>
    </>
  );
};

export default ShiftDetailsDialog;
