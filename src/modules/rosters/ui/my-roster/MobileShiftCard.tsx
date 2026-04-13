import React, { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Clock, MapPin, ArrowLeftRight, X, Loader2 } from 'lucide-react';
import { Shift } from '@/modules/rosters';
import { useDropShift } from '@/modules/rosters/state/useRosterShifts';
import { useSwaps } from '@/modules/planning';
import { useToast } from '@/modules/core/hooks/use-toast';
import { isShiftLocked, isShiftCommenced } from '@/modules/rosters/domain/shift-locking.utils';
import CreateSwapRequestModal from './CreateSwapRequestModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Label } from '@/modules/core/ui/primitives/label';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/modules/core/ui/primitives/drawer';

interface MobileShiftCardProps {
  shiftData: {
    shift: Shift;
    groupName: string;
    groupColor: string;
    subGroupName: string;
  };
  selectedDay: Date;
  onActionComplete?: () => void;
}

const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getGradientClass = (color: string): string => {
  const base = 'dept-card-glass-base';
  switch (color?.toLowerCase()) {
    case 'convention':
      return `${base} dept-card-glass-convention border-blue-400/30 shadow-blue-500/20`;
    case 'exhibition':
      return `${base} dept-card-glass-exhibition border-green-400/30 shadow-green-500/20`;
    case 'theatre':
      return `${base} dept-card-glass-theatre border-red-400/30 shadow-red-500/20`;
    default:
      return `${base} dept-card-glass-default border-slate-400/30 shadow-slate-500/20`;
  }
};

export const MobileShiftCard: React.FC<MobileShiftCardProps> = ({ shiftData, selectedDay, onActionComplete }) => {
  const { shift, groupName, groupColor, subGroupName } = shiftData;
  const { toast } = useToast();
  const { mySwapRequests, myActiveOfferDetails, isLoadingOfferDetails } = useSwaps();

  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const dropShiftMutation = useDropShift();
  const isDropping = dropShiftMutation.isPending;

  // --- Logic from ShiftDetailsDialog ---
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

  const isS3PendingOffer = shift.lifecycle_status === 'Published' && shift.assignment_status === 'assigned' && !shift.assignment_outcome;
  const isLockedFromActions = shift.is_cancelled || !!existingSwapRequest || isPendingInOffer || isWithinLockoutPeriod || isS3PendingOffer || isActiveOrCommenced || hasCheckedIn;

  const confirmDrop = async () => {
    if (!cancelReason.trim()) {
      toast({ title: 'Reason Required', description: 'Please provide a reason for dropping this shift.', variant: 'destructive' });
      return;
    }
    dropShiftMutation.mutate(
      { shiftId: shift.id, reason: cancelReason.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Shift Dropped', description: 'You have successfully dropped this shift.' });
          setIsCancelConfirmOpen(false);
          setCancelReason('');
          onActionComplete?.();
        },
        onError: (error: any) => {
          toast({ title: 'Drop Failed', description: error?.message || 'Failed to drop shift.', variant: 'destructive' });
        }
      }
    );
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-6 min-h-[180px] transition-all active:scale-[0.99] border border-white/10 shadow-2xl flex flex-col justify-between",
        getGradientClass(groupColor)
      )}
    >
      {/* Header: GROUP | SUBGROUP */}
      <div className="flex justify-between items-start mb-3">
        <div className="space-y-1">
          <div className="text-white/60 font-black text-[10px] uppercase tracking-widest">
            {groupName} | {subGroupName}
          </div>
          <div className="text-white font-black text-xl leading-tight tracking-tight">
            {shift.roles?.name || 'Shift'}
          </div>
        </div>
      </div>

      {/* Details Row */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-white/90">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 opacity-70" />
          <span className="text-[12px] font-black tracking-tight">
            {formatTime(shift.start_time)}-{formatTime(shift.end_time)}
          </span>
        </div>
        {shift.locations?.name && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 opacity-70" />
            <span className="text-[12px] font-black tracking-tight uppercase truncate max-w-[180px]">
              {shift.locations.name}
            </span>
          </div>
        )}
      </div>

      {/* Embedded Action Buttons */}
      <div className="flex gap-4 mt-8">
        <Button
          onClick={(e) => { e.stopPropagation(); setIsSwapModalOpen(true); }}
          disabled={isLockedFromActions}
          className={cn(
            "flex-1 h-12 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all",
            "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20 border-none"
          )}
        >
          <ArrowLeftRight size={16} className="mr-2" />
          Swap
        </Button>
        <Button
          onClick={(e) => { e.stopPropagation(); setIsCancelConfirmOpen(true); }}
          disabled={isLockedFromActions}
          className={cn(
            "flex-1 h-12 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all",
            "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20 border-none"
          )}
        >
          <X size={16} className="mr-2" />
          Drop
        </Button>
      </div>

      {/* Confirmation Modals (Modals remain for multi-step confirmation) */}
      <CreateSwapRequestModal
        isOpen={isSwapModalOpen}
        onClose={() => setIsSwapModalOpen(false)}
        shift={shift}
        shiftDate={new Date(shift.shift_date)}
        groupName={groupName}
        subGroupName={subGroupName}
        groupColor={groupColor}
      />

      <Drawer open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
        <DrawerContent className="border-white/10 bg-slate-900/95 backdrop-blur-2xl px-4">
          <DrawerHeader>
            <DrawerTitle className="text-xl font-black uppercase tracking-tight text-white">Drop Shift</DrawerTitle>
            <DrawerDescription className="text-muted-foreground/80">
               Why are you dropping this shift?
            </DrawerDescription>
          </DrawerHeader>
          <div className="py-2 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest opacity-60 text-white/60">Reason Required</Label>
              <Textarea
                placeholder="Manager needs to know why..."
                className="rounded-2xl bg-white/5 border-white/10 min-h-[120px] text-white"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DrawerFooter className="gap-3 pb-8">
            <Button variant="ghost" onClick={() => setIsCancelConfirmOpen(false)} className="rounded-2xl h-14 uppercase text-xs font-black text-white hover:bg-white/5">Keep Shift</Button>
            <Button onClick={confirmDrop} disabled={isDropping || !cancelReason.trim()} className="rounded-2xl h-14 uppercase text-xs font-black bg-rose-600 hover:bg-rose-700 text-white shadow-xl shadow-rose-900/20">
              {isDropping ? <Loader2 className="animate-spin h-5 w-5" /> : 'Confirm Drop'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
