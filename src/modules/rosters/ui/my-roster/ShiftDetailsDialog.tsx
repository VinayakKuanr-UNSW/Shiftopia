import React, { useState } from 'react';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
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
  Clock,
  X,
  Coffee,
  Building,
  Timer,
  CalendarDays,
  Loader2,
  ArrowLeftRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Shift } from '@/modules/rosters';
import { useDropShift } from '@/modules/rosters/state/useRosterShifts';
import { useSwaps } from '@/modules/planning';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import CreateSwapRequestModal from './CreateSwapRequestModal';

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

// Helper to format time for display
const formatTime = (time: string): string => {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}:${m.toString().padStart(2, '0')} ${period} `;
};

// Get gradient class based on color
const getGradientClass = (color: string): string => {
  switch (color) {
    case 'blue': return 'bg-gradient-to-br from-blue-600 to-blue-800';
    case 'green': return 'bg-gradient-to-br from-green-600 to-green-800';
    case 'red': return 'bg-gradient-to-br from-red-600 to-red-800';
    case 'purple': return 'bg-gradient-to-br from-purple-600 to-purple-800';
    default: return 'bg-gradient-to-br from-slate-600 to-slate-800';
  }
};

// Calculate net length from times
const calculateNetLength = (startTime: string, endTime: string, breakMinutes: number): string => {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  let total = eh * 60 + em - (sh * 60 + sm);
  if (total < 0) total += 24 * 60; // Handle overnight

  const net = total - breakMinutes;
  const h = Math.floor(net / 60);
  const m = net % 60;

  return m ? `${h}h ${m} m` : `${h} h`;
};

const ShiftDetailsDialog: React.FC<ShiftDetailsDialogProps> = ({
  isOpen,
  onClose,
  shiftData,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mySwapRequests, isLoading: isSwapsLoading, refetchMySwaps } = useSwaps();
  const { user } = useAuth();

  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Use centralized hooks
  const dropShiftMutation = useDropShift();
  const isDropping = dropShiftMutation.isPending;

  // Lock to prevent double submission race conditions
  const isSubmittingRef = React.useRef(false);

  if (!shiftData) return null;
  const { shift, groupName, groupColor, subGroupName } = shiftData;

  const shiftDate = new Date(shift.shift_date);

  // HOISTED: Check if shift is within 4 hours of start (Lockout period)
  // CHECK LOCK STATUS (Strict Sydney Timezone) - EMPLOYEE CONTEXT
  const isWithinLockoutPeriod = isShiftLocked(shift.shift_date, shift.start_time, 'my_roster');

  console.log('[ShiftDetailsDialog] Lockout Check (Sydney/Employee):', {
    shiftId: shift.id,
    shiftDate: shift.shift_date,
    startTime: shift.start_time,
    isLocked: isWithinLockoutPeriod
  });

  // Check if there is already an active swap request for this shift
  // Status values match the DB enum: OPEN, MANAGER_PENDING, APPROVED
  const existingSwapRequest = mySwapRequests.find(
    s => (s.requester_shift_id === shift.id || s.original_shift_id === shift.id) &&
      (s.status === 'OPEN' || s.status === 'MANAGER_PENDING')
  );

  const netLength = calculateNetLength(
    shift.start_time,
    shift.end_time,
    shift.break_minutes || 0
  );

  const handleDropShift = () => setIsCancelConfirmOpen(true);
  const handleSwapShift = () => setIsSwapModalOpen(true);

  const confirmDrop = async () => {
    if (!cancelReason.trim()) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for dropping this shift.',
        variant: 'destructive'
      });
      return;
    }

    // CRITICAL: Check if shift is within 4 hours of start time
    if (isWithinLockoutPeriod) {
      toast({
        title: 'Drop Not Allowed',
        description: `Cannot drop shift within 4 hours of start time.`,
        variant: 'destructive'
      });
      return;
    }

    console.log('[ShiftDetailsDialog] Starting drop for shift:', shift.id, 'Reason:', cancelReason);

    // Use the mutation hook
    dropShiftMutation.mutate(
      { shiftId: shift.id, reason: cancelReason.trim() },
      {
        onSuccess: (result) => {
          console.log('[ShiftDetailsDialog] Drop RPC Result:', result);
          toast({
            title: 'Shift Dropped',
            description: 'You have successfully dropped this shift. It is now available for bidding.',
          });
          setIsCancelConfirmOpen(false);
          setCancelReason('');
          onClose();
        },
        onError: (error: any) => {
          console.error('[ShiftDetailsDialog] Error dropping shift:', error);
          const errorMessage = error?.message || error?.error?.message || 'Failed to drop shift. Please try again.';
          toast({
            title: 'Drop Failed',
            description: errorMessage,
            variant: 'destructive'
          });
        }
      }
    );
  };

  // Lock to prevent double submission race conditions - Moved to top






  const getRemunerationColor = (levelName: string | undefined) => {
    const level = levelName?.toUpperCase() || '';
    if (level.includes('PLATINUM')) return 'bg-gradient-to-r from-slate-400 to-slate-500 text-white';
    if (level.includes('GOLD')) return 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black';
    if (level.includes('SILVER')) return 'bg-gradient-to-r from-gray-400 to-gray-500 text-white';
    if (level.includes('BRONZE')) return 'bg-gradient-to-r from-orange-700 to-orange-800 text-white';
    return 'bg-gray-500 text-white';
  };



  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
              className={cn(
                'max-w-md text-white border-0 shadow-2xl p-0 overflow-hidden',
                getGradientClass(groupColor)
              )}
            >
              <DialogHeader className="sr-only">
                <DialogTitle>{shift.roles?.name || 'Shift'} Details</DialogTitle>
                <DialogDescription>
                  Shift details for {format(shiftDate, 'EEEE, MMMM d, yyyy')} at{' '}
                  {shift.organizations?.name || 'Unknown Organization'}
                </DialogDescription>
              </DialogHeader>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                {/* Visual Header Section */}
                <div className="p-5 pb-0">
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-[10px] text-white/60 mb-3 flex items-center gap-1 flex-wrap"
                  >
                    <Building className="h-3 w-3" />
                    <span>{shift.organizations?.name || 'Organization'}</span>
                    <span className="text-white/30">|</span>
                    <span>{shift.departments?.name || 'Department'}</span>
                    <span className="text-white/30">|</span>
                    <span>{shift.sub_departments?.name || subGroupName}</span>
                  </motion.div>

                  <Badge className="mb-2 bg-black/20 text-white border-white/20 hover:bg-black/30">
                    {subGroupName || shift.sub_group_name || 'General'}
                  </Badge>

                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-2xl font-bold">{shift.roles?.name || 'No Role Assigned'}</h2>
                    {shift.remuneration_levels?.level_name && (
                      <Badge
                        className={cn(
                          'text-xs font-bold',
                          getRemunerationColor(shift.remuneration_levels.level_name)
                        )}
                      >
                        {shift.remuneration_levels.level_name}
                      </Badge>
                    )}
                  </div>

                  <p className="text-sm text-white/70 mb-4">
                    {format(shiftDate, 'EEEE, MMMM d, yyyy')}
                  </p>
                </div>

                {/* Info Cards Section */}
                <div className="px-5 space-y-2">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20">
                    <Clock className="h-5 w-5 text-white/70 flex-shrink-0" />
                    <div className="font-semibold text-lg">
                      {formatTime(shift.start_time)} -{' '}
                      {formatTime(shift.end_time)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-black/20">
                      <Coffee className="h-4 w-4 text-white/70 flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-white/50 uppercase">
                          Break
                        </div>
                        <div className="font-medium text-sm">
                          {shift.break_minutes > 0 ? `${shift.break_minutes} min` : 'N/A'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-black/20">
                      <Timer className="h-4 w-4 text-white/70 flex-shrink-0" />
                      <div>
                        <div className="text-[10px] text-white/50 uppercase">
                          Net Length
                        </div>
                        <div className="font-medium text-sm">{netLength}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20">
                    <CalendarDays className="h-5 w-5 text-white/70 flex-shrink-0" />
                    <div className="font-medium">
                      {shift.is_cancelled ? 'Cancelled' : shift.status || 'Assigned'}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="p-5 pt-4">
                  <div className="flex gap-2">
                    <Button
                      onClick={onClose}
                      variant="outline"
                      className="flex-1 border-white/30 text-white bg-transparent hover:bg-white/10 rounded-full"
                    >
                      Close
                    </Button>
                    <Button
                      onClick={handleSwapShift}
                      disabled={shift.is_cancelled || !!existingSwapRequest || isWithinLockoutPeriod}
                      className={cn(
                        "flex-1 text-white rounded-full shadow-lg disabled:opacity-50 disabled:cursor-not-allowed",
                        isWithinLockoutPeriod ? "bg-slate-600" : "bg-purple-600 hover:bg-purple-700 shadow-purple-500/30"
                      )}
                    >
                      <ArrowLeftRight size={16} className="mr-2" />
                      {existingSwapRequest ? 'Requested' : isWithinLockoutPeriod ? 'Locked' : 'Swap'}
                    </Button>
                    <Button
                      onClick={handleDropShift}
                      disabled={isWithinLockoutPeriod || !!existingSwapRequest}
                      className={cn(
                        "flex-1 text-white rounded-full shadow-lg disabled:opacity-50 disabled:cursor-not-allowed",
                        isWithinLockoutPeriod ? "bg-slate-600" : "bg-red-600 hover:bg-red-500 shadow-red-500/30"
                      )}
                    >
                      <X size={16} className="mr-2" />
                      {existingSwapRequest ? 'Swap Active' : isWithinLockoutPeriod ? 'Locked' : 'Drop'}
                    </Button>
                  </div>
                  {isWithinLockoutPeriod && (
                    <p className="text-xs text-center text-white/50 mt-2">
                      Actions locked 4 hours before shift start
                    </p>
                  )}
                </div>
              </motion.div>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>

      {/* Swap Request Modal - Using Enhanced Component */}
      <CreateSwapRequestModal
        isOpen={isSwapModalOpen}
        onClose={() => setIsSwapModalOpen(false)}
        shift={shift}
        shiftDate={shiftDate}
        groupName={groupName}
        subGroupName={subGroupName}
        groupColor={groupColor}
      />

      {/* Cancel Shift Confirmation Dialog */}
      <Dialog open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Shift Assignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to drop this shift?
              Depending on the timing, this may require manager approval or affect your reliability score.
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
            <Button
              variant="outline"
              onClick={() => setIsCancelConfirmOpen(false)}
              disabled={isDropping}
            >
              Keep Shift
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDropShift(cancelReason)}
              disabled={isDropping || !cancelReason.trim()}
            >
              {isDropping ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dropping...
                </>
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
