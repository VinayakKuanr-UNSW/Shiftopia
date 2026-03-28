import React, { useState } from 'react';
import { isShiftLocked, isShiftCommenced } from '@/modules/rosters/domain/shift-locking.utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Label } from '@/modules/core/ui/primitives/label';
import {
  X,
  ArrowLeftRight,
  History,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { Shift } from '@/modules/rosters';
import { useDropShift } from '@/modules/rosters/state/useRosterShifts';
import { AttendanceBadge } from '@/modules/rosters/ui/components/AttendanceBadge';
import { ShiftTimeline } from '@/modules/audit/components/ShiftTimeline';
import { useSwaps } from '@/modules/planning';
import { useToast } from '@/modules/core/hooks/use-toast';
import CreateSwapRequestModal from './CreateSwapRequestModal';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';

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
  const [showHistory, setShowHistory] = useState(false);

  const dropShiftMutation = useDropShift();
  const isDropping = dropShiftMutation.isPending;

  if (!shiftData) return null;
  const { shift, groupName, groupColor, subGroupName } = shiftData;

  const shiftDate = new Date(shift.shift_date);

  const isWithinLockoutPeriod = isShiftLocked(shift.shift_date, shift.start_time, 'my_roster');
  const isCommenced = isShiftCommenced(shift.shift_date, shift.start_time);

  const existingSwapRequest = mySwapRequests.find(
    s => (s.requester_shift_id === shift.id || s.original_shift_id === shift.id) &&
      (s.status === 'OPEN' || s.status === 'MANAGER_PENDING')
  );

  const isPendingInOffer = isLoadingOfferDetails
    ? true
    : myActiveOfferDetails?.some(offer => offer.offered_shift_id === shift.id);

  const isActiveOrCommenced = shift.lifecycle_status === 'InProgress' || shift.lifecycle_status === 'Completed' || isCommenced;
  const hasCheckedIn = shift.attendance_status === 'checked_in' || shift.attendance_status === 'late';

  const isLockedFromActions = shift.is_cancelled || !!existingSwapRequest || isPendingInOffer || isWithinLockoutPeriod || shift.assignment_outcome === 'offered' || isActiveOrCommenced || hasCheckedIn;

  // ── SharedShiftCard props ──────────────────────────────────────────────────
  const paidBreak = (shift as any).paid_break_minutes ?? 0;
  const unpaidBreak = (shift as any).unpaid_break_minutes ?? shift.break_minutes ?? 0;

  const [sh, sm] = shift.start_time.split(':').map(Number);
  const [eh, em] = shift.end_time.split(':').map(Number);
  let gross = (eh * 60 + em) - (sh * 60 + sm);
  if (gross < 0) gross += 1440;
  const netLengthMinutes = Math.max(0, gross - unpaidBreak);

  const urgency = computeShiftUrgency(shift.shift_date, shift.start_time, (shift as any).start_at);

  const groupVariant = (() => {
    if (shift.group_type === 'convention_centre') return 'convention' as const;
    if (shift.group_type === 'exhibition_centre') return 'exhibition' as const;
    if (shift.group_type === 'theatre') return 'theatre' as const;

    const name = (shift.departments?.name || '').toLowerCase();
    if (name.includes('convention')) return 'convention' as const;
    if (name.includes('exhibition')) return 'exhibition' as const;
    if (name.includes('theatre') || name.includes('theater')) return 'theatre' as const;
    return 'default' as const;
  })();

  // ── Status badge ───────────────────────────────────────────────────────────
  const statusText = shift.is_cancelled ? 'Cancelled'
    : shift.lifecycle_status === 'Completed' ? 'Completed'
    : isActiveOrCommenced ? 'In Progress'
    : hasCheckedIn ? 'Clocked In'
    : existingSwapRequest ? (isWithinLockoutPeriod ? 'Swap Expired' : 'Swap Active')
    : shift.assignment_outcome === 'offered' ? 'Offer Pending'
    : 'Assigned';

  const statusBadgeCls = shift.is_cancelled
    ? 'bg-red-500/10 text-red-500 border-red-500/20'
    : shift.lifecycle_status === 'Completed' || isActiveOrCommenced || hasCheckedIn
      ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      : existingSwapRequest
        ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
        : shift.assignment_outcome === 'offered'
          ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
          : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';

  const scheduledStartISO = `${shift.shift_date}T${shift.start_time}`;
  const scheduledEndISO = `${shift.shift_date}T${shift.end_time}`;
  const showAttendanceBadge = shift.lifecycle_status === 'InProgress' || shift.lifecycle_status === 'Completed';

  // ── Button labels ──────────────────────────────────────────────────────────
  const swapLabel = isActiveOrCommenced || hasCheckedIn ? 'Locked'
    : isPendingInOffer ? 'Offer Pending'
    : existingSwapRequest ? (isWithinLockoutPeriod ? 'Expired' : 'Requested')
    : isWithinLockoutPeriod ? 'Locked'
    : shift.assignment_outcome === 'offered' ? 'Open Bid'
    : 'Swap';

  const dropLabel = isActiveOrCommenced || hasCheckedIn ? 'Locked'
    : isPendingInOffer ? 'Locked via Offer'
    : existingSwapRequest ? (isWithinLockoutPeriod ? 'Expired' : 'Swap Active')
    : isWithinLockoutPeriod ? 'Locked'
    : 'Drop';

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
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-background border-border rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{shift.roles?.name || 'Shift'} Details</DialogTitle>
            <DialogDescription>
              Shift details for {format(shiftDate, 'EEEE, MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>

          {/* Shift Card */}
          <div className="p-4 pb-0">
            <SharedShiftCard
              variant="default"
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
              statusIcons={
                <div className="col-span-3 flex flex-wrap gap-2 items-center">
                  <Badge variant="outline" className={cn('text-[9px] font-black uppercase tracking-wider', statusBadgeCls)}>
                    {statusText}
                  </Badge>
                  {shift.remuneration_levels?.level_name && (
                    <Badge className="text-[9px] font-black bg-primary/10 text-primary border-primary/20 border uppercase tracking-wider">
                      {shift.remuneration_levels.level_name}
                    </Badge>
                  )}
                  {shift.remuneration_levels?.hourly_rate_min && (
                    <span className="text-[9px] font-mono font-black text-muted-foreground">
                      ${shift.remuneration_levels.hourly_rate_min}/hr
                    </span>
                  )}
                  {showAttendanceBadge && (
                    <AttendanceBadge
                      attendanceStatus={shift.attendance_status ?? 'unknown'}
                      actualStart={shift.actual_start}
                      scheduledStart={scheduledStartISO}
                      actualEnd={shift.actual_end}
                      scheduledEnd={scheduledEndISO}
                      lifecycleStatus={shift.lifecycle_status as 'InProgress' | 'Completed'}
                    />
                  )}
                </div>
              }
            />
          </div>

          {/* Shift History */}
          <div className="px-4 pt-3">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Shift History
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground/50 transition-transform', showHistory && 'rotate-180')} />
            </button>
            {showHistory && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-muted/20 px-3 py-2">
                <ShiftTimeline shiftId={shift.id} className="text-foreground/80" />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-4 pt-3">
            <div className="flex gap-2">
              <Button
                onClick={onClose}
                variant="outline"
                className="flex-1 border-border/50 bg-transparent hover:bg-muted rounded-full"
              >
                Close
              </Button>
              <Button
                onClick={handleSwapShift}
                disabled={isLockedFromActions}
                className={cn(
                  'flex-1 text-white rounded-full shadow-lg disabled:opacity-50 disabled:cursor-not-allowed',
                  isWithinLockoutPeriod ? 'bg-slate-600' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/30'
                )}
              >
                <ArrowLeftRight size={16} className="mr-2" />
                {swapLabel}
              </Button>
              <Button
                onClick={handleDropShift}
                disabled={isLockedFromActions}
                className={cn(
                  'flex-1 text-white rounded-full shadow-lg disabled:opacity-50 disabled:cursor-not-allowed',
                  isActiveOrCommenced || hasCheckedIn || isWithinLockoutPeriod ? 'bg-slate-600' : 'bg-red-600 hover:bg-red-500 shadow-red-500/30'
                )}
              >
                <X size={16} className="mr-2" />
                {dropLabel}
              </Button>
            </div>
            {isWithinLockoutPeriod && (
              <p className="text-xs text-center text-muted-foreground mt-2">
                Actions locked 4 hours before shift start
              </p>
            )}
            {isPendingInOffer && !isWithinLockoutPeriod && (
              <p className="text-xs text-center text-amber-500/80 mt-2 font-medium">
                You have an active pending offer for this shift.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
      <Dialog open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Shift Assignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to drop this shift? Depending on the timing, this may require manager approval or affect your reliability score.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
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
          </div>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ShiftDetailsDialog;
